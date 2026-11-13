// Bridge 0.9.0 (batch 5, "social read switch"): the periodic social READ is OFF until the owner turns it on in the popup.
// browser-bridge/social-switch.js (worker half) + social-switch-popup.js (popup half). Posting is untouched: the existing
// popup-approval / social-claim / social-cancel tests stay unchanged and are the proof of that.
//
// background.js runs in a vm with a fake chrome (like browser-ext-flush.test.mjs). The REAL social.js is loaded, so a "read" is
// observed as what it really is: socialTick asking chrome.tabs.query({}) for the open tabs (a call with no filter; the focus
// tracker only ever queries { active: true, ... }). Tests that need background.js / popup.html / manifest / README to carry the
// shared edits skip with a PENDING reason until those land (as grab-routes.test.mjs does); SOCIAL_SW_TEST_BG points the worker
// tests at a patched copy of background.js, for checking the edit text before it is applied.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

const EXT = fileURLToPath(new URL('../browser-bridge/', import.meta.url));
const rd = (n) => fs.readFileSync(EXT + n, 'utf8');
const BG_PATH = process.env.SOCIAL_SW_TEST_BG || EXT + 'background.js';
const BG = fs.readFileSync(BG_PATH, 'utf8');
const SWITCH = rd('social-switch.js');
const POPUP_SW = rd('social-switch-popup.js');
const WIRED = /importScripts\(\s*'social-switch\.js'\s*\)/.test(BG) && /socialSwEnsureAlarm\(\)/.test(BG) && /social:set/.test(BG);
const PENDING = !WIRED && 'PENDING the shared edit: background.js does not import social-switch.js yet';

const J = (x) => JSON.parse(JSON.stringify(x));   // vm objects have another realm's prototypes: compare plain copies
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => { for (let i = 0; i < 12; i++) await tick(); };

function loadWorker({ store = {}, alarms = {} } = {}) {
  const log = { create: [], clear: [], tabQueries: [], fetches: [] };
  const L = { onInstalled: [], onStartup: [], onAlarm: [], onMessage: [] };
  const ev = (k) => ({ addListener: (fn) => L[k].push(fn) });
  const alarmMap = { ...alarms };
  const chrome = {
    storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => { Object.assign(store, o); }, remove: async (k) => { delete store[k]; } } },
    runtime: { onInstalled: ev('onInstalled'), onStartup: ev('onStartup'), onMessage: ev('onMessage') },
    tabs: { onActivated: { addListener() {} }, onUpdated: { addListener() {} }, query: async (q) => { log.tabQueries.push(q || {}); return []; } },
    windows: { onFocusChanged: { addListener() {} }, WINDOW_ID_NONE: -1 },
    idle: { onStateChanged: { addListener() {} }, setDetectionInterval() {} },
    alarms: { onAlarm: ev('onAlarm'),
      create(name, info) { log.create.push([name, info]); alarmMap[name] = info; },
      clear: async (name) => { log.clear.push(name); const had = name in alarmMap; delete alarmMap[name]; return had; } },
    contextMenus: { onClicked: { addListener() {} }, create() {}, removeAll: async () => {} },
    downloads: { onChanged: { addListener() {} } },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  };
  const fetchImpl = async (url) => { log.fetches.push(String(url)); throw new Error('no network in this test'); };
  const ctx = vm.createContext({ chrome, fetch: fetchImpl, URL, console, setTimeout, clearTimeout, AbortController, TextEncoder, Uint8Array, Uint32Array, crypto: webcrypto });
  ctx.globalThis = ctx;
  ctx.importScripts = (...names) => { for (const n of names) vm.runInContext(fs.readFileSync(EXT + n, 'utf8'), ctx, { filename: n }); };
  vm.runInContext(BG, ctx, { filename: 'background.js' });
  // a 'read' = one socialTick that really asked for the open tabs (it asks once per site; the focus tracker only ever sends { active: true })
  let reads = 0, ticks = 0;
  const realTick = ctx.socialTick;
  ctx.socialTick = async (...a) => { ticks++; const before = log.tabQueries.filter((q) => !('active' in q)).length; try { return await realTick(...a); } finally { if (log.tabQueries.filter((q) => !('active' in q)).length > before) reads++; } };
  const readCount = () => reads;
  const boot = async () => { await Promise.all(L.onStartup.map((fn) => fn())); await settle(); };
  const alarm = async (name) => { for (const fn of L.onAlarm) fn({ name }); await settle(); };
  const message = async (msg) => {
    for (const fn of L.onMessage) {
      let done; const p = new Promise((r) => { done = r; });
      const ret = fn(msg, {}, (x) => done(x));
      if (ret === true) { const out = await p; await settle(); return out; }
    }
    return undefined;
  };
  return { ctx, store, log, alarms: alarmMap, readCount, ticks: () => ticks, boot, alarm, message };
}

// ---- the worker: default OFF ----------------------------------------------------------------------------------------------

test('no stored setting: boot creates no social alarm, clears any left by an older version, and reads nothing', { skip: PENDING }, async () => {
  const w = loadWorker({ alarms: { social: { periodInMinutes: 5 } } });   // the alarm an 0.8.0 install left behind
  await w.boot();
  assert.ok(!('social' in w.alarms), 'the old alarm is gone');
  assert.ok(w.log.clear.includes('social'));
  assert.ok(!w.log.create.some(([n]) => n === 'social'), 'no social alarm is ever created');
  assert.equal(w.readCount(), 0, 'no tab was asked about: nothing was read');
  assert.ok(!w.log.fetches.some((u) => u.includes('/ingest/social') || u.includes('/social/accounts')), 'nothing social was sent');
});

test('the other alarms are untouched by the switch: flush, the Brief badge and the claude.ai sync keep their own handling', { skip: PENDING }, async () => {
  const w = loadWorker();
  await w.boot();
  assert.deepEqual(J(w.log.create.find(([n]) => n === 'flush')[1]), { periodInMinutes: 0.5 });
  assert.deepEqual(J(w.log.create.find(([n]) => n === w.ctx.HQAssist.ALARM)[1]), { periodInMinutes: 5 });
  assert.ok(w.log.clear.includes('claude-sync'), 'claude.ai sync is still off-by-default and cleared by its own code');
  assert.ok(!w.log.clear.includes('flush') && !w.log.clear.includes(w.ctx.HQAssist.ALARM), 'the switch clears only the social alarm');
});

test('anything but { on: true } is OFF', { skip: PENDING }, async () => {
  for (const bad of [undefined, null, false, true, 'on', 1, {}, { on: 'true' }, { on: 1 }, { on: false, at: 5 }, [{ on: true }]]) {
    const w = loadWorker({ store: { hq_social_read: bad } });
    await w.boot();
    assert.ok(!('social' in w.alarms), 'alarm absent for ' + JSON.stringify(bad));
    assert.equal(w.readCount(), 0, 'no read for ' + JSON.stringify(bad));
  }
});

test('an alarm that fires while OFF (an old one fired first) never reads', { skip: PENDING }, async () => {
  const w = loadWorker();
  await w.alarm('social');
  await w.alarm('social');
  assert.equal(w.readCount(), 0);
});

// ---- the worker: ON ---------------------------------------------------------------------------------------------------------

test('setting on: the alarm is created with a 5 minute period and boot reads once', { skip: PENDING }, async () => {
  const w = loadWorker({ store: { hq_social_read: { on: true, at: 1 } } });
  await w.boot();
  assert.deepEqual(J(w.alarms.social), { periodInMinutes: 5 });
  assert.equal(w.readCount(), 1);
  await w.alarm('social');
  assert.equal(w.readCount(), 2, 'and each alarm reads once');
});

test("'social:set' flips it live: off clears the alarm and a later alarm does nothing; on creates it and stores { on, at }", { skip: PENDING }, async () => {
  const w = loadWorker({ store: { hq_social_read: { on: true, at: 1 } } });
  await w.boot();
  assert.equal(w.readCount(), 1);
  const off = await w.message({ type: 'social:set', on: false });
  assert.equal(off.on, false);
  assert.ok(!('social' in w.alarms));
  assert.equal(w.store.hq_social_read.on, false);
  await w.alarm('social');
  assert.equal(w.readCount(), 1, 'an alarm after the off switch reads nothing');
  const on = await w.message({ type: 'social:set', on: true });
  assert.equal(on.on, true);
  assert.deepEqual(J(w.alarms.social), { periodInMinutes: 5 });
  assert.equal(w.store.hq_social_read.on, true);
  assert.ok(Number.isFinite(w.store.hq_social_read.at) && w.store.hq_social_read.at > 0);
  assert.equal(w.readCount(), 1, 'switching on does not read by itself: the first read is the next alarm');
  await w.alarm('social');
  assert.equal(w.readCount(), 2);
});

test("'social:set' only turns ON for a real true: a string, a number or no value is OFF", { skip: PENDING }, async () => {
  const w = loadWorker({ store: { hq_social_read: { on: true, at: 1 } } });
  await w.boot();
  for (const v of ['true', 'yes', 1, undefined, null]) {
    const r = await w.message({ type: 'social:set', on: v });
    assert.equal(r.on, false, 'on: ' + JSON.stringify(v));
    assert.ok(!('social' in w.alarms));
  }
});

test('on plus the existing pause switch (hq_cfg.paused) still reads nothing', { skip: PENDING }, async () => {
  const w = loadWorker({ store: { hq_social_read: { on: true, at: 1 }, hq_cfg: { paused: true } } });
  await w.boot();
  assert.deepEqual(J(w.alarms.social), { periodInMinutes: 5 }, 'the alarm exists');
  await w.alarm('social');
  assert.equal(w.readCount(), 0, 'socialTick returned at its own paused check');
});

test("the popup's manual 'sync' still reads while the switch is OFF (it is the owner's click)", { skip: PENDING }, async () => {
  const w = loadWorker();
  await w.boot();
  assert.equal(w.readCount(), 0);
  const r = await w.message({ type: 'social:sync' });
  assert.deepEqual(J(r), { ok: true });
  assert.equal(w.readCount(), 1);
  assert.ok(!('social' in w.alarms), 'a manual sync does not switch the timer on');
});

test('posting is not behind the switch: social:send is still routed to socialSend with the OFF switch', { skip: PENDING }, async () => {
  const w = loadWorker();
  await w.boot();
  let got = null;
  w.ctx.socialSend = async (a) => { got = a; return { ok: false, error: 'placeholder' }; };   // the worker's own global, replaced by the test
  const r = await w.message({ type: 'social:send', action: { id: 'act-1', platform: 'bluesky', op: 'post', text: 'placeholder post' } });
  assert.equal(got.id, 'act-1');
  assert.equal(r.ok, false);
});

// ---- social-switch.js on its own (no background.js needed) ----------------------------------------------------------------

test('social-switch.js alone: load runs nothing, names are socialSw-prefixed, the alarm follows the setting', async () => {
  const calls = [];
  const store = {};
  const chrome = { storage: { local: { get: async (k) => ({ [k]: store[k] }), set: async (o) => { Object.assign(store, o); } } },
    alarms: { create: (n, i) => calls.push(['create', n, i]), clear: async (n) => { calls.push(['clear', n]); } } };
  const ctx = vm.createContext({ chrome, Date, Number });
  vm.runInContext(SWITCH, ctx, { filename: 'social-switch.js' });
  assert.deepEqual(J(calls), [], 'nothing ran at load');
  vm.runInContext('globalThis.reads = 0; var socialTick = async () => { reads++; };', ctx);
  assert.deepEqual(J(await ctx.socialSwGet()), { on: false, at: 0 });
  assert.deepEqual(J(await ctx.socialSwTick()), { read: false, reason: 'off' });
  assert.equal(ctx.reads, 0);
  await ctx.socialSwEnsureAlarm();
  assert.deepEqual(J(calls), [['clear', 'social']], 'off clears (and works without social.js globals, falling back to 5 and "social")');
  await ctx.socialSwSet(true);
  assert.deepEqual(J(calls.at(-1)), ['create', 'social', { periodInMinutes: 5 }]);
  assert.deepEqual(J(await ctx.socialSwTick()), { read: true });
  assert.equal(ctx.reads, 1);
  await ctx.socialSwSet(false);
  assert.deepEqual(J(calls.at(-1)), ['clear', 'social']);
  // a storage failure reads as OFF, never as on
  chrome.storage.local.get = async () => { throw new Error('storage unavailable'); };
  assert.deepEqual(J(await ctx.socialSwGet()), { on: false, at: 0 });
  // top-level names stay in the socialSw namespace
  const names = [...SWITCH.matchAll(/^(?:async function|function|const|let|var)\s+([A-Za-z_$][\w$]*)/gm)].map((m) => m[1]);
  assert.ok(names.length >= 6 && names.every((n) => n.startsWith('socialSw')), names.join(','));
});

test('the two new scripts make no network call and carry no token', () => {
  for (const [name, src] of [['social-switch.js', SWITCH], ['social-switch-popup.js', POPUP_SW]]) {
    assert.ok(!/fetch\s*\(/.test(src), name + ' must not call fetch(');
    assert.ok(!/X-HQ-Token/i.test(src), name + ' must not carry the token header');
    assert.ok(!/XMLHttpRequest|WebSocket|sendBeacon|innerHTML/.test(src), name + ' stays on storage, alarms and messages');
  }
});

// ---- the popup half ---------------------------------------------------------------------------------------------------------

function fakeDoc({ withHost = true, strict = false } = {}) {
  const make = (tag) => ({ tag, className: '', textContent: '', id: '', checked: false, disabled: false, children: [], listeners: {},
    appendChild(c) { this.children.push(c); return c; }, addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); } });
  const host = make('section'); host.id = 'social-auto';
  return { createElement: make, host,
    getElementById: (id) => { if (id === 'social-auto' && withHost) return host; if (strict) throw new Error('no #' + id); return null; } };
}
const walk = (e, out = []) => { out.push(e); for (const c of e.children || []) walk(c, out); return out; };
function fakeApi({ stored } = {}) {
  const sent = [];
  const api = { storage: { local: { get: async (k) => ({ [k]: stored }) } },
    runtime: { sendMessage: async (m) => { sent.push(m); return { on: m.on }; } } };
  return { sent, api };
}
function loadPopupSw(doc, api) {
  const ctx = vm.createContext({ document: doc, chrome: api });
  vm.runInContext(POPUP_SW, ctx, { filename: 'social-switch-popup.js' });
  return ctx;
}

test('popup: the section carries the exact words and starts OFF', async () => {
  const doc = fakeDoc(); const { api } = fakeApi({ stored: undefined });
  loadPopupSw(doc, api); await settle();
  const all = walk(doc.host);
  const text = all.map((e) => e.textContent).join(' | ');
  assert.ok(text.includes('Read my logged-in social tabs every 5 minutes. When on, the extension reads the feed, mentions and account numbers visible in tabs you already have open and logged in, and sends them to this app. Nothing in the app uses what it reads today. Off by default. Posting stays behind Approve & send either way.'));
  assert.ok(/Nothing in the app uses what it reads today/.test(text) && /Off by default/.test(text));
  const box = all.find((e) => e.tag === 'input');
  assert.equal(box.type, 'checkbox'); assert.equal(box.checked, false);
  assert.match(all.find((e) => e.id === 'social-read-status').textContent, /^Off — nothing is read/);
});

test('popup: it shows the stored state on open, and anything but { on: true } shows off', async () => {
  const doc = fakeDoc(); const { api } = fakeApi({ stored: { on: true, at: 3 } });
  loadPopupSw(doc, api); await settle();
  assert.equal(walk(doc.host).find((e) => e.tag === 'input').checked, true);
  assert.match(walk(doc.host).find((e) => e.id === 'social-read-status').textContent, /^On — reading/);
  for (const bad of [{ on: 'true' }, { on: 1 }, 'on', null]) {
    const d = fakeDoc(); const f = fakeApi({ stored: bad });
    loadPopupSw(d, f.api); await settle();
    assert.equal(walk(d.host).find((e) => e.tag === 'input').checked, false, JSON.stringify(bad));
  }
});

test("popup: ticking sends 'social:set' with a real boolean; the box follows the worker's answer; a failed answer puts it back and says so", async () => {
  const doc = fakeDoc(); const f = fakeApi({ stored: undefined });
  loadPopupSw(doc, f.api); await settle();
  const box = walk(doc.host).find((e) => e.tag === 'input');
  const status = walk(doc.host).find((e) => e.id === 'social-read-status');
  box.checked = true; box.listeners.change.forEach((fn) => fn()); await settle();
  assert.deepEqual(J(f.sent), [{ type: 'social:set', on: true }]);
  assert.equal(box.checked, true); assert.match(status.textContent, /^On — reading/); assert.equal(box.disabled, false);
  // the worker answers with nothing usable: the box returns to what is still in force and the words say so
  f.api.runtime.sendMessage = async () => undefined;
  box.checked = false; box.listeners.change.forEach((fn) => fn()); await settle();
  assert.equal(box.checked, true, 'put back to what is still in force');
  assert.equal(status.textContent, "Couldn't change this — try again.");
  f.api.runtime.sendMessage = async () => { throw new Error('worker asleep'); };
  box.checked = false; box.listeners.change.forEach((fn) => fn()); await settle();
  assert.equal(box.checked, true);
  assert.equal(status.textContent, "Couldn't change this — try again.");
  assert.equal(box.disabled, false);
});

test('popup: null-safe with no #social-auto (null or a strict fake that throws), no chrome, or a half-built chrome', async () => {
  for (const d of [fakeDoc({ withHost: false }), fakeDoc({ withHost: false, strict: true })]) {
    const { api } = fakeApi({}); const ctx = loadPopupSw(d, api); await settle();
    assert.equal(ctx.socialSwPopupInit(d, api), null);
  }
  assert.equal(vm.runInContext(POPUP_SW + '\nsocialSwPopupInit(document, undefined)', vm.createContext({ document: fakeDoc() })), null);
  assert.equal(vm.runInContext(POPUP_SW + '\nsocialSwPopupInit(document, { storage: {} })', vm.createContext({ document: fakeDoc() })), null);
  vm.runInContext(POPUP_SW, vm.createContext({}));   // neither document nor chrome: nothing runs, nothing throws
});

// ---- the shared edits (skip until they land) --------------------------------------------------------------------------------

const HTML = rd('popup.html');
test('popup.html carries the social-auto placeholder and loads the popup script ahead of the guard scripts', { skip: !/id="social-auto"/.test(HTML) && 'PENDING the shared edit: popup.html has no #social-auto yet' }, () => {
  assert.equal((HTML.match(/id="social-auto"/g) || []).length, 1);
  const scripts = [...HTML.matchAll(/<script\s+src="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(scripts.includes('social-switch-popup.js'));
  assert.ok(scripts.indexOf('social-switch-popup.js') < scripts.indexOf('endpoint-guard.js'), 'before the 0.7.0 scripts, so the popup-tokens last-six order check stays as it was');
  assert.ok(HTML.indexOf('id="social-auto"') < HTML.indexOf('<script src="endpoint-guard.js">'), 'the placeholder exists before the scripts run');
  const apprStart = HTML.indexOf('<section id="appr"');
  const appr = HTML.slice(apprStart, HTML.indexOf('</section>', apprStart));
  assert.ok(!appr.includes('social-auto'), 'outside #appr, which stays hidden until something is staged');
});

const MANIFEST = JSON.parse(rd('manifest.json'));
test('manifest: permissions and host permissions are exactly the 0.8.0 set (the switch adds none)', () => {
  assert.deepEqual(MANIFEST.permissions, ['tabs', 'storage', 'alarms', 'idle', 'scripting', 'activeTab', 'contextMenus', 'downloads']);
  assert.deepEqual(MANIFEST.host_permissions, ['http://127.0.0.1/*', 'http://localhost/*', 'https://bsky.app/*', 'https://*.reddit.com/*', 'https://x.com/*', 'https://twitter.com/*', 'https://*.linkedin.com/*', 'https://*.instagram.com/*', 'https://*.threads.net/*', 'https://*.threads.com/*', 'https://*.facebook.com/*', 'https://*.youtube.com/*']);
  assert.deepEqual(MANIFEST.optional_host_permissions, ['https://*/*', 'https://claude.ai/*']);
  assert.equal(MANIFEST.background.service_worker, 'background.js');
});
test('manifest: version is 0.9.0 (the app route /health bridge string stays 0.8.0 on purpose)', { skip: MANIFEST.version !== '0.9.0' && 'PENDING the shared edit: manifest.json is still ' + MANIFEST.version }, () => {
  assert.equal(MANIFEST.version, '0.9.0');
});

const README = rd('README.md');
const SOCIAL_SECTION = README.slice(README.indexOf('**Social feeds'), README.indexOf('**It also publishes'));
test('README: the Social section says the periodic read is OFF by default and where the toggle is', { skip: !/off by default/i.test(SOCIAL_SECTION) && 'PENDING the shared edit: README.md still says the read runs every 5 minutes' }, () => {
  assert.match(SOCIAL_SECTION, /off by default/i);
  assert.match(SOCIAL_SECTION, /popup/i);
});
