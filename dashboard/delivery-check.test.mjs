// node --test dashboard/delivery-check.test.mjs
// Client delivery check, main side, over a FAKE window (no Electron): the three network layers are armed before the first load,
// outside requests are cancelled and counted by host, one run at a time, the window is always destroyed, the budgets hold, and
// everything written lands under <dataDir>/delivery. Placeholder names only (acme, example.test).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { create, idHash } = require('./delivery-check.js');

const PROJECT = { id: 'acme-site', dev_cmd: 'vite --port 5173' };
const latest = () => ({ projects: [PROJECT, { id: 'beta-site' }] });
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hq-dck-test-'));
const RAW = (o = {}) => ({
  title: 'Acme Studio', viewport: { innerWidth: 390, scrollWidth: 390 }, meta: { hasViewport: true, content: 'width=device-width' },
  html: { lang: 'en', dir: '' }, overflow: [], smallText: { count: 0, total: 5 }, taps: { total: 2, under44: 0, under24: 0, samples: [] },
  bidi: { rtlRuns: 0, unisolated: 0, samples: [] }, strings: ['Welcome to Acme'], links: { alternates: [], anchors: [], options: [] }, ...o,
});
const LANG_LINKS = { alternates: [{ hreflang: 'fr', path: '/fr' }, { hreflang: 'ar', path: '/ar' }], anchors: [], options: [] };

// a BrowserWindow-like. opts.pages: path -> raw snapshot; opts.requests: urls the "page" asks for on each load;
// opts.loadHook(url): replaces loadURL's behaviour (async)
function fakeWindow(opts = {}) {
  const log = [], loads = [], results = [];
  let hook = null, destroyed = false;
  const handlers = {};
  const ses = {
    setProxy: async (cfg) => { log.push(['proxy', cfg]); },
    webRequest: { onBeforeRequest: (fn) => { hook = fn; log.push(['webRequest']); } },
    setPermissionRequestHandler: (fn) => { handlers.permission = fn; log.push(['permission']); },
    setPermissionCheckHandler: (fn) => { handlers.permissionCheck = fn; },
  };
  const wc = {
    session: ses,
    setWebRTCIPHandlingPolicy: (p) => log.push(['webrtc', p]),
    setWindowOpenHandler: (fn) => { handlers.open = fn; },
    on: (ev, fn) => { handlers[ev] = fn; },
    enableDeviceEmulation: (cfg) => { log.push(['emulation', cfg]); if (!log.some((e) => e[0] === 'blank')) log.push(['emulation-before-any-page']); },
    loadURL: async (url) => {
      if (url === 'about:blank') { log.push(['blank']); return; }   // Electron 32 needs a loaded page before device emulation; it asks the network for nothing
      log.push(['load', url]); loads.push(url);
      if (opts.loadHook) return opts.loadHook(url);
      if (loads.length === 1) for (const u of opts.requests || []) results.push([u, await new Promise((res) => hook({ url: u }, res))]);
    },
    executeJavaScriptInIsolatedWorld: async (id, scripts) => { log.push(['probe', id, scripts]); const p = new URL(loads[loads.length - 1]).pathname; return (opts.pages || {})[p] || RAW(); },
    capturePage: async () => ({ isEmpty: () => false, toPNG: () => Buffer.from('png') }),
  };
  const win = { webContents: wc, isDestroyed: () => destroyed, destroy: () => { destroyed = true; log.push(['destroy']); } };
  return { win, log, loads, handlers, results, get destroyed() { return destroyed; } };
}
const setup = (o = {}) => {
  const dataDir = tmp();
  const fw = fakeWindow(o.window || {});
  const c = create({ dataDir, latest, makeWindow: () => fw.win, settleMs: 0, probeUrl: async () => null, ...(o.create || {}) });
  return { dataDir, fw, c };
};
const URL1 = 'http://127.0.0.1:5173';

test('run: the proxy, the WebRTC policy and the request hook are armed before the first load', async () => {
  const { fw, c } = setup();
  const r = await c.run('acme-site', 'http://localhost:5173');
  assert.ok(!r.error, r.error);
  const order = fw.log.map((e) => e[0]);
  const firstLoad = order.indexOf('load');
  for (const armed of ['proxy', 'webrtc', 'webRequest', 'permission', 'emulation']) assert.ok(order.indexOf(armed) >= 0 && order.indexOf(armed) < firstLoad, armed + ' before the first load');
  for (const armed of ['proxy', 'webrtc', 'webRequest', 'permission']) assert.ok(order.indexOf(armed) < order.indexOf('blank'), armed + ' before even the blank page');
  assert.ok(order.indexOf('blank') >= 0 && order.indexOf('blank') < order.indexOf('emulation'), 'the blank page goes first, then device emulation (Electron 32 crashes otherwise)');
  assert.ok(!order.includes('emulation-before-any-page'), 'emulation never runs on a window with no page');
  const proxy = fw.log.find((e) => e[0] === 'proxy')[1];
  assert.equal(proxy.proxyRules, 'http://127.0.0.1:9');
  assert.equal(proxy.proxyBypassRules, '127.0.0.1,localhost,[::1]');
  assert.equal(fw.log.find((e) => e[0] === 'webrtc')[1], 'disable_non_proxied_udp');
  assert.deepEqual(fw.log.find((e) => e[0] === 'emulation')[1].screenSize, { width: 390, height: 844 });
  assert.equal(fw.loads[0], 'http://127.0.0.1:5173/', 'localhost is rewritten to 127.0.0.1');
});

test('run: an outside request is cancelled and counted by host while a loopback one passes', async () => {
  const urls = ['http://127.0.0.1:5173/app.js', 'ws://localhost:5173/hmr', 'https://fonts.example.test/css?family=x', 'https://fonts.example.test/b', 'http://192.168.1.5/x', 'data:text/plain,hi'];
  const { fw, c } = setup({ window: { requests: urls } });
  const r = await c.run('acme-site', URL1);
  assert.deepEqual(fw.results.map(([u, v]) => [u, !!v.cancel]), urls.map((u, i) => [u, i >= 2 && i <= 4]));
  assert.equal(r.blocked.count, 3);
  assert.deepEqual(r.blocked.hosts, [{ host: 'fonts.example.test', count: 2 }, { host: '192.168.1.5', count: 1 }]);
  assert.equal(r.blockedLine, '3 outside requests blocked (fonts.example.test, 192.168.1.5)');
  assert.doesNotMatch(JSON.stringify(r), /css\?family|\/b"|\/x"/, 'hosts only: never a path or a query');
  assert.ok(!/nothing left your pc/i.test(JSON.stringify(r)), 'blocked and counted, never an absolute');
  assert.equal(r.requestsSeen, 2, 'loopback requests are counted as seen, data: is not');
});

test('run: more than 200 requests are cut off and the report says so', async () => {
  const urls = Array.from({ length: 205 }, (_, i) => 'http://127.0.0.1:5173/a' + i);
  const { fw, c } = setup({ window: { requests: urls } });
  const r = await c.run('acme-site', URL1);
  assert.equal(fw.results.filter(([, v]) => v.cancel).length, 5);
  assert.equal(r.truncated.requests, true);
  assert.ok(r.notes.some((n) => /more than 200 requests/.test(n)));
});

test('run: navigation off the confirmed origin is denied, permissions and window.open are denied', async () => {
  const { fw, c } = setup();
  await c.run('acme-site', URL1);
  let prevented = 0; const ev = { preventDefault: () => { prevented++; } };
  fw.handlers['will-navigate'](ev, 'https://other.example.test/'); fw.handlers['will-redirect'](ev, 'http://127.0.0.1:9999/');
  assert.equal(prevented, 2);
  fw.handlers['will-navigate'](ev, 'http://127.0.0.1:5173/fr'); assert.equal(prevented, 2, 'same origin passes');
  let granted = 'unset'; fw.handlers.permission({}, 'media', (g) => { granted = g; });
  assert.equal(granted, false); assert.equal(fw.handlers.permissionCheck(), false);
  assert.deepEqual(fw.handlers.open({ url: 'https://x.example.test' }), { action: 'deny' });
});

test('run: the address is checked again in main (the renderer value is never trusted)', async () => {
  const { fw, c } = setup();
  for (const bad of ['https://acme.example.test', 'http://192.168.1.20:3000', 'http://127.0.0.1.evil.test:5173', 'http://user:pw@127.0.0.1:5173', 'file:///etc/hosts', 'javascript:1', '', null, undefined, 42]) {
    const r = await c.run('acme-site', bad);
    assert.match(r.error, /^Only a dev server on this PC can be checked/, String(bad));
  }
  assert.equal(fw.loads.length, 0); assert.equal(fw.log.length, 0, 'no window was even made');
});

test('run: one at a time, and the second asks again later', async () => {
  let release; const gate = new Promise((r) => { release = r; });
  const { fw, c } = setup({ window: { loadHook: () => gate } });
  const first = c.run('acme-site', URL1);
  await new Promise((r) => setTimeout(r, 10));
  const second = await c.run('acme-site', URL1);
  assert.equal(second.error, 'a check is already running.');
  release(); const done = await first;
  assert.ok(!done.error, done.error);
  assert.equal(fw.destroyed, true);
  const third = await c.run('acme-site', URL1);   // the flag was released
  assert.notEqual(third.error, 'a check is already running.');
});

test('run: the window is destroyed on success, on a load error, on timeout and when it cannot be made', async () => {
  const ok = setup(); assert.ok(!(await ok.c.run('acme-site', URL1)).error); assert.equal(ok.fw.destroyed, true);
  const bad = setup({ window: { loadHook: async () => { throw new Error('ERR_CONNECTION_REFUSED'); } } });
  const rb = await bad.c.run('acme-site', URL1);
  assert.match(rb.error, /did not load — ERR_CONNECTION_REFUSED/); assert.equal(bad.fw.destroyed, true);
  const slow = setup({ window: { loadHook: () => new Promise(() => {}) }, create: { limits: { RUN_MS: 60 } } });
  const rs = await slow.c.run('acme-site', URL1);
  assert.match(rs.error, /ran past its \d+ s limit/); assert.equal(slow.fw.destroyed, true);
  const noWin = setup({ create: { makeWindow: () => { throw new Error('no window'); } } });
  assert.match((await noWin.c.run('acme-site', URL1)).error, /did not finish — no window/);
});

test('run: language routes are visited (at most six), the entry is not repeated, and no switch says so', async () => {
  const many = ['ar', 'fr', 'en', 'de', 'es', 'it', 'pt', 'nl'].map((l) => ({ hreflang: l, path: '/' + l }));
  const { fw, c } = setup({ window: { pages: { '/': RAW({ links: { alternates: many, anchors: [], options: [] } }) } } });
  const r = await c.run('acme-site', URL1);
  assert.ok(fw.loads.length <= 1 + 6, 'entry plus at most six routes, got ' + fw.loads.length);
  assert.equal(r.routes.length, fw.loads.length);
  assert.equal(fw.loads.filter((u) => u.endsWith('/')).length, 1);
  const none = setup(); const rn = await none.c.run('acme-site', URL1);
  assert.equal(rn.languageSwitch, 'none'); assert.ok(rn.notes.includes('No language switch found, so nothing was checked per language'));
  assert.equal(none.fw.loads.length, 1, 'no routes are guessed');
});

test('run: findings come through the core; reports and shots are written under data/delivery only', async () => {
  const pages = { '/': RAW({ meta: { hasViewport: false, content: '' }, links: LANG_LINKS }), '/fr': RAW({ html: { lang: 'fr', dir: '' } }), '/ar': RAW({ html: { lang: 'ar', dir: '' } }) };
  const { dataDir, c } = setup({ window: { pages } });
  const r = await c.run('acme-site', URL1);
  assert.deepEqual(r.findings.map((f) => f.id).sort(), ['dir', 'viewport']);
  const h = idHash('acme-site');
  const reportFile = path.join(dataDir, 'delivery', 'checks', h + '.json');
  assert.ok(fs.existsSync(reportFile));
  assert.equal(JSON.parse(fs.readFileSync(reportFile, 'utf8')).v, 1);
  const shots = fs.readdirSync(path.join(dataDir, 'delivery', 'shots'));
  assert.deepEqual(shots.slice().sort(), [h + '-0.png', h + '-1.png', h + '-2.png']);
  assert.deepEqual(r.shots.slice().sort(), shots.slice().sort());
  assert.deepEqual(fs.readdirSync(dataDir).sort(), ['delivery'], 'nothing else was created in the data dir');
  assert.deepEqual((await c.read('acme-site')).findings.map((f) => f.id).sort(), ['dir', 'viewport']);
  assert.equal(c.shotPath(shots[0]), path.join(dataDir, 'delivery', 'shots', shots[0]));
  assert.equal(c.shotPath('../../x.png'), null);
});

test('run: shots are capped at 12 across projects, oldest first, and only shot-shaped names are touched', async () => {
  const { dataDir, c } = setup();
  const shotsDir = path.join(dataDir, 'delivery', 'shots'); fs.mkdirSync(shotsDir, { recursive: true });
  const other = idHash('beta-site');
  for (let i = 0; i < 14; i++) { const f = path.join(shotsDir, other + '-' + i + '.png'); fs.writeFileSync(f, 'x'); const t = new Date(2020, 0, 1, 0, i); fs.utimesSync(f, t, t); }
  fs.writeFileSync(path.join(shotsDir, 'notes.txt'), 'not a shot: never deleted');
  await c.run('acme-site', URL1);
  const left = fs.readdirSync(shotsDir).filter((n) => n.endsWith('.png'));
  assert.equal(left.length, 12);
  assert.ok(left.includes(idHash('acme-site') + '-0.png'), 'the fresh shot survives');
  assert.ok(!left.includes(other + '-0.png'), 'the oldest went first');
  assert.ok(fs.existsSync(path.join(shotsDir, 'notes.txt')));
});

test('forget removes the report and that project\'s shots only; a hostile project id never escapes', async () => {
  const { dataDir, c } = setup();
  await c.run('acme-site', URL1);
  const shotsDir = path.join(dataDir, 'delivery', 'shots');
  const keep = idHash('beta-site') + '-0.png'; fs.writeFileSync(path.join(shotsDir, keep), 'x');
  assert.deepEqual(await c.forget('acme-site'), { ok: true });
  assert.equal(await c.read('acme-site'), null);
  assert.deepEqual(fs.readdirSync(shotsDir), [keep]);
  // a hostile id is hashed to a fixed-shape name, never joined raw
  const outside = path.join(path.dirname(dataDir), 'hq-dck-outside-' + process.pid + '.json'); fs.writeFileSync(outside, '{}');
  const evil = '../' + path.basename(outside).replace(/\.json$/, '');
  assert.deepEqual(await c.forget(evil), { ok: true });
  assert.equal(await c.read(evil), null);
  assert.ok(fs.existsSync(outside), 'a file outside the data dir is untouched');
  fs.unlinkSync(outside);
  assert.match((await c.run('../escape', URL1)).error, /not in the current scan/);
  for (const bad of ['', null, 5, 'x'.repeat(300)]) { assert.equal(await c.read(bad), null); assert.ok((await c.forget(bad)).error); }
});

test('read: a damaged or foreign report is null, never thrown', async () => {
  const { dataDir, c } = setup();
  const dir = path.join(dataDir, 'delivery', 'checks'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, idHash('acme-site') + '.json'), '{not json');
  assert.equal(await c.read('acme-site'), null);
  fs.writeFileSync(path.join(dir, idHash('acme-site') + '.json'), JSON.stringify({ v: 9 }));
  assert.equal(await c.read('acme-site'), null);
});

test('detect: probes candidates even when the id is absent from devServers; devServers only decides the "started here" note', async () => {
  const probed = [];
  const probeUrl = async (origin) => { probed.push(origin); return origin.endsWith(':5173') ? { ok: true, title: 'Acme Studio' } : null; };
  const a = setup({ create: { probeUrl, devServers: new Map() } });
  const ra = await a.c.detect('acme-site');
  assert.deepEqual([ra.state, ra.startedHere, ra.hasCommand], ['ready', false, true]);
  assert.deepEqual(ra.candidates, [{ origin: 'http://127.0.0.1:5173', title: 'Acme Studio' }]);
  assert.deepEqual(probed, ['http://127.0.0.1:5173'], 'stops at the first answer');
  const b = setup({ create: { probeUrl, devServers: new Map([['acme-site', {}]]) } });
  assert.equal((await b.c.detect('acme-site')).startedHere, true);
});

test('detect: nothing answering and no saved command are honest states; an unknown project is an error', async () => {
  const probed = [];
  const { c } = setup({ create: { probeUrl: async (o) => { probed.push(o); return null; } } });
  const r = await c.detect('beta-site');      // no dev_cmd: framework defaults only
  assert.deepEqual([r.state, r.hasCommand, r.candidates], ['nothing-answering', false, []]);
  assert.equal(probed.length, 6); assert.equal(probed[0], 'http://127.0.0.1:5173');
  assert.ok((await c.detect('nope')).error);
  assert.ok((await c.detect('')).error);
  const thrower = setup({ create: { probeUrl: async () => { throw new Error('boom'); } } });
  assert.equal((await thrower.c.detect('acme-site')).state, 'nothing-answering', 'a failing probe counts as not answering');
});
