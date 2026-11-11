// Bridge 0.8.0 (batch 3, "grab-into-cosmos"): after a save the owner's click made has FINISHED, the service worker (browser-bridge/grab.js)
// tells the app about the file (POST /library/grab through HQGuard.guardedFetch) so it also lands in Cosmos as a clip. This runs
// grab-rules.js + grab.js (+ the real endpoint-guard.js where it matters) in node vms with a fake chrome and a fake app. No network.
//   node --test dashboard/grab-cosmos-ext.test.mjs
// grab.js and grab-rules.js are shared files the Pass edits. Until it has, this suite runs against the SAME edit applied in memory
// (INTENDED_EDIT below: exact-anchor replacements, each asserted to match); once the file already carries the edit ('savedPath' in
// grab.js) the file is used as it is and the in-memory step does nothing. HQ_WRITE_PATCHED=<dir> writes the two edited sources there.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { webcrypto, createHmac } from 'node:crypto';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(HERE, '..', 'browser-bridge');
const read = (f) => readFileSync(resolve(EXT, f), 'utf8');
const plain = (x) => JSON.parse(JSON.stringify(x));
const tick = () => new Promise((r) => setImmediate(r));

// ---- the edit the Pass makes (anchors are exact lines of the 0.7.0 files) ----------------------------------------------------------
const GRAB_HELPERS = `    // ---- 0.8.0: a saved file also lands in Cosmos (only after a save the owner's click made has finished) ----------------------------
    var COSMOS_ROUTE = '/library/grab', COSMOS_TIMEOUT_MS = 30000, COSMOS_RETRY_MS = 20000, COSMOS_GIVE_UP_MS = 24 * 60 * 60 * 1000;
    var COSMOS_DEFAULTS = { endpoint: 'http://127.0.0.1:47821', token: '' };
    var COSMOS_WORDS = { 400: 'it could not read the request', 401: 'pair the Bridge first', 403: 'pair the Bridge first', 404: 'it could not find the file', 409: 'set it up first', 413: 'too large for a clip', 415: 'not a picture or video it keeps', 422: 'the file changed while it was copied', 429: 'too many grabs this hour' };
    function needsPost(j) { return j.state === 'saved' && j.cosmos === 'pending' && !!j.savedPath; }
    // the file's name must be read BEFORE the patch that clears downloadId: after that the id is gone
    async function savedFileOf(downloadId) {
      try { var items = await C().downloads.search({ id: downloadId }); var f = items && items[0] && items[0].filename; return typeof f === 'string' ? f : ''; }
      catch (e) { return ''; }
    }
    async function cosmosCfg() { var r = await C().storage.local.get('hq_cfg'); return Object.assign({}, COSMOS_DEFAULTS, (r && r.hq_cfg) || {}); }
    // one POST per saved job, through the endpoint guard (loopback only, and the app must prove it holds the token before the path leaves).
    // A failure never fails the save: it only sets the Cosmos words on the job. 'pending' (the app closed, a 5xx) is tried again later; a
    // re-post is harmless because the app names a clip by its hash.
    async function postCosmos(id, force) {
      var q = await readQueue(), job = q.jobs.filter(function (j) { return j.id === id; })[0];
      if (!job || !needsPost(job)) return;
      if (!force && now() - (job.cosmosAt || 0) < COSMOS_RETRY_MS) return;
      if (now() - (job.at || 0) > COSMOS_GIVE_UP_MS) { await patch(id, { cosmos: 'refused: Cosmos was not reachable' }); return; }
      await patch(id, { cosmosAt: now() });
      var result = 'pending';
      try {
        var c = await cosmosCfg();
        if (!c.token) result = 'refused: pair the Bridge first';
        else {
          var init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: job.savedPath, pageUrl: job.pageUrl || '', pageTitle: job.pageTitle || '' }) };
          try { if (root.AbortSignal && root.AbortSignal.timeout) init.signal = root.AbortSignal.timeout(COSMOS_TIMEOUT_MS); } catch (e) { /* no timeout */ }
          var guard = deps.guard || root.HQGuard;
          var res = await guard.guardedFetch(c, COSMOS_ROUTE, init, deps.appFetch ? { fetch: deps.appFetch } : undefined);
          var body = null;
          try { body = await res.json(); } catch (e) { body = null; }
          if (res.status === 200 && body && body.ok === true) result = body.duplicate === true ? 'duplicate' : 'added';
          else if (COSMOS_WORDS[res.status]) result = 'refused: ' + COSMOS_WORDS[res.status];
        }
      } catch (e) {
        if (e && e.code === 'not-on-pc') result = 'refused: the endpoint is not on this PC';
      }
      if (result !== 'pending') await patch(id, { cosmos: result });
    }
    async function retryCosmos() {
      var q = await readQueue(), due = q.jobs.filter(needsPost);
      for (var n = 0; n < due.length; n++) await postCosmos(due[n].id, false);
    }

`;

const INTENDED_EDIT = {
  'grab.js': [
    ["function viewOf(j) { return { id: j.id, key: j.key, host: j.host, kind: j.kind, state: j.state, tried: j.tried, message: j.message || '' }; }",
      "function viewOf(j) { var v = { id: j.id, key: j.key, host: j.host, kind: j.kind, state: j.state, tried: j.tried, message: j.message || '' }; if (j.cosmos && j.cosmos !== 'none') v.cosmos = j.cosmos; return v; }"],
    ['var key = rules.normalizeUrl(entry.url), host = rules.hostOf(entry.url), job = null, full = false;',
      "var key = rules.normalizeUrl(entry.url), host = rules.hostOf(entry.url), job = null, full = false, pageUrl = String(msg.pageUrl || '').slice(0, 2048), pageTitle = String(msg.pageTitle || '').slice(0, 200);"],
    ["attemptIdx: -1, message: '', at: now() };", "attemptIdx: -1, message: '', pageUrl: pageUrl, pageTitle: pageTitle, at: now() };"],
    ["await patch(id, { state: 'saved', tried: i + 1, downloadId: null, message: '' });",
      "var savedPath = await savedFileOf(job.downloadId);\n            await patch(id, { state: 'saved', tried: i + 1, downloadId: null, message: '', savedPath: savedPath, cosmos: savedPath ? 'pending' : 'none' });\n            await postCosmos(id, true);"],
    ['    async function runJob(id) {', GRAB_HELPERS + '    async function runJob(id) {'],
    ['        } finally { running = null; await syncAlarm(); }', '          await retryCosmos();\n        } finally { running = null; await syncAlarm(); }'],
  ],
  'grab-rules.js': [
    ["    if (job.state === 'saved') return 'saved to Downloads/' + SAVE_ROOT + '/' + safeHost(job.host) + '/';",
      "    if (job.state === 'saved') return 'saved to Downloads/' + SAVE_ROOT + '/' + safeHost(job.host) + '/' + cosmosWords(job.cosmos);"],
    ['  function stateText(job) {',
      "  // 0.8.0: the honest words for what Cosmos did with a saved file ('' while nothing was asked of it)\n  function cosmosWords(r) {\n    if (r === 'added') return ', and added to Cosmos';\n    if (r === 'duplicate') return ', already in Cosmos';\n    if (r === 'pending') return ', Cosmos has not answered yet';\n    if (typeof r === 'string' && r.indexOf('refused: ') === 0) return '; Cosmos says: ' + r.slice(9);\n    return '';\n  }\n  function stateText(job) {"],
  ],
};

function source(file) {
  const src = read(file);
  if (file === 'grab.js' ? src.includes('savedPath') : src.includes('cosmosWords')) return { src, edited: false };
  let out = src;
  for (const [from, to] of INTENDED_EDIT[file]) {
    assert.equal(out.split(from).length, 2, `anchor must match exactly once in ${file}: ${from.slice(0, 60)}`);
    out = out.replace(from, () => to);
  }
  return { src: out, edited: true };
}
const GRAB = source('grab.js');
const RULES = source('grab-rules.js');

test('the edit is applied in memory only while the file does not have it yet; HQ_WRITE_PATCHED writes the edited sources for the Pass', () => {
  assert.ok(GRAB.src.includes('postCosmos') && RULES.src.includes('cosmosWords'));
  if (process.env.HQ_WRITE_PATCHED) {
    mkdirSync(process.env.HQ_WRITE_PATCHED, { recursive: true });
    writeFileSync(join(process.env.HQ_WRITE_PATCHED, 'grab.js'), GRAB.src);
    writeFileSync(join(process.env.HQ_WRITE_PATCHED, 'grab-rules.js'), RULES.src);
  }
});

// ---- a fake chrome that outlives a "worker" ------------------------------------------------------------------------------------------
const POPUP_SENDER = { id: 'ext-abc', url: 'chrome-extension://ext-abc/popup.html' };
const PAGE = 'https://alpha-site.test/blog/post?utm=1';
const TOKEN = 'b2'.repeat(32);
const DL_ROOT = 'C:\\Users\\placeholder\\Downloads\\';
const img = (url, kind = 'image') => ({ url, kind, variants: [] });

function makeWorld({ cfg = { endpoint: 'http://127.0.0.1:47821', token: TOKEN }, filenames = true } = {}) {
  const t = { v: 5_000_000 };
  const world = {
    t, store: new Map(), items: new Map(), events: [], downloads: [], gens: [], cfg: { hq_cfg: cfg }, nextId: 0,
    outcome: () => 'complete',
    now: () => t.v,
    sleep: async (ms) => { t.v += ms; },
  };
  world.store.set('__w', 0);
  world.chromeFor = () => {
    const gen = { listeners: [] }; world.gens.push(gen);
    return {
      storage: {
        session: {
          get: async (k) => (world.store.has(k) ? { [k]: structuredClone(world.store.get(k)) } : {}),
          set: async (o) => { for (const [k, v] of Object.entries(o)) { world.store.set(k, structuredClone(v)); world.events.push(['set', k, structuredClone(v)]); } },
          remove: async (k) => { world.store.delete(k); },
        },
        local: { get: async (k) => (world.cfg[k] !== undefined ? { [k]: structuredClone(world.cfg[k]) } : {}) },
      },
      runtime: { id: 'ext-abc', getURL: (p) => 'chrome-extension://ext-abc/' + p },
      alarms: { create() {}, clear() {} },
      action: { setBadgeText: async () => {}, openPopup: async () => {} },
      contextMenus: { removeAll: (cb) => cb(), create: (o, cb) => cb && cb(), onClicked: { addListener() {} } },
      downloads: {
        download: async (opts) => {
          world.downloads.push(plain(opts));
          const id = ++world.nextId;
          world.items.set(id, { id, url: opts.url, state: 'in_progress', startTime: new Date(t.v).toISOString(), error: '', mime: 'image/jpeg', ...(filenames ? { filename: DL_ROOT + opts.filename.replace(/\//g, '\\') } : {}) });
          setImmediate(() => world.finish(id, world.outcome(opts.url)));
          return id;
        },
        search: async (q) => { world.events.push(['search', q.id != null ? 'id' : 'url']); return [...world.items.values()].filter((d) => (q.id == null || d.id === q.id) && (q.url == null || d.url === q.url)).map((d) => ({ ...d })); },
        onChanged: { addListener: (f) => gen.listeners.push(f), removeListener: (f) => { const i = gen.listeners.indexOf(f); if (i >= 0) gen.listeners.splice(i, 1); } },
      },
    };
  };
  world.finish = (id, how) => {
    const it = world.items.get(id); if (!it || it.state !== 'in_progress') return;
    it.state = how === 'complete' ? 'complete' : 'interrupted';
    if (how !== 'complete') it.error = how === 'canceled' ? 'USER_CANCELED' : 'NETWORK_FAILED';
    const delta = { id, state: { current: it.state } };
    if (it.error) delta.error = { current: it.error };
    const live = world.gens[world.gens.length - 1];
    if (live) live.listeners.slice().forEach((f) => f(delta));
  };
  world.queue = () => (world.store.get('hq_grab_queue') || { jobs: [] }).jobs;
  return world;
}

/** the app on the other end: a fake that answers /library/grab the way the route does, and remembers what it was told. */
function makeApp() {
  const app = { posts: [], seen: new Set(), mode: 'ok', status: 0 };
  app.answer = (init) => {
    const body = JSON.parse(init.body);
    app.posts.push({ method: init.method, headers: { ...(init.headers || {}) }, body });
    if (app.mode === 'down') { const e = new Error('WorkspaceHQ is not reachable — open the app'); e.code = 'unreachable'; throw e; }
    if (app.mode === 'status') return { status: app.status, json: async () => ({ ok: false, error: 'x' }) };
    if (app.mode === 'html') return { status: 200, json: async () => { throw new SyntaxError('not json'); } };
    const dup = app.seen.has(body.path);
    app.seen.add(body.path);
    return { status: 200, json: async () => ({ ok: true, ...(dup ? { duplicate: true } : {}), indexed: false }) };
  };
  return app;
}

function makeWorker(world, app, { realGuard = false, guard } = {}) {
  const chrome = world.chromeFor();
  const ctx = vm.createContext({ console, URL, AbortSignal: undefined, AbortController, TextEncoder, setTimeout, clearTimeout, crypto: webcrypto });
  ctx.globalThis = ctx;
  vm.runInContext(RULES.src, ctx);
  vm.runInContext(GRAB.src, ctx);
  const guardCalls = [];
  const fakeGuard = guard || {
    guardedFetch: async (cfg, p, init, env) => {
      const job = world.queue().find((j) => j.state === 'saved' || j.state === 'saving');
      guardCalls.push({ cfg: plain(cfg), p, init: plain({ ...init, signal: undefined }), jobStateAtCall: job && job.state, env });
      return app.answer(init);
    },
  };
  let deps = { chrome, now: world.now, sleep: world.sleep, fetch: async () => { throw new Error('no site is contacted in these tests'); }, guard: fakeGuard };
  if (realGuard) {
    vm.runInContext(read('endpoint-guard.js'), ctx);
    deps = { chrome, now: world.now, sleep: world.sleep, fetch: deps.fetch, guard: ctx.HQGuard, appFetch: realGuard };
  }
  const grab = ctx.HQGrab.create(deps);
  const save = (entry, over = {}) => grab.enqueue({ type: 'grab:save', entry, pageUrl: PAGE, ...over }, POPUP_SENDER);
  return { grab, chrome, rules: ctx.HQGrabRules, guardCalls, save, ctx };
}
const settled = async (world) => { for (let i = 0; i < 80; i++) { for (let k = 0; k < 6; k++) await tick(); const q = world.queue(); if (q.length && q.every((j) => (j.state === 'saved' && j.cosmos !== 'pending') || j.state === 'failed' || (j.state === 'saved' && j.cosmos === 'pending' && j.cosmosAt))) return; } };
const SAVED_PATH = DL_ROOT + 'WorkspaceHQ\\grabs\\alpha-site.test\\a.jpg';

// ---- the post -----------------------------------------------------------------------------------------------------------------------
describe('a save finishes, then the app hears of it', () => {
  test('savedPath is read BEFORE downloadId is cleared, and the job keeps it (not the live download id)', async () => {
    const world = makeWorld(), app = makeApp(), w = makeWorker(world, app);
    await w.save(img('https://alpha-site.test/m/a.jpg'));
    await w.grab.idle(); await settled(world);
    const savedWrite = world.events.findIndex((e) => e[0] === 'set' && e[1] === 'hq_grab_queue' && e[2].jobs.some((j) => j.state === 'saved'));
    assert.ok(savedWrite > 0);
    const firstSaved = world.events[savedWrite][2].jobs[0];
    assert.deepEqual([firstSaved.state, firstSaved.downloadId, firstSaved.savedPath, firstSaved.cosmos], ['saved', null, SAVED_PATH, 'pending'], 'the same write that clears the id carries the path');
    const lastSearchById = world.events.map((e, i) => (e[0] === 'search' && e[1] === 'id' ? i : -1)).filter((i) => i >= 0).pop();
    assert.ok(lastSearchById < savedWrite, 'the filename lookup happened before the saved patch');
    assert.equal(world.queue()[0].savedPath, SAVED_PATH);
    assert.equal(world.queue()[0].pageUrl, PAGE);
  });

  test('nothing is posted before a click: install, the menu, an empty pump and a download event post nothing', async () => {
    const world = makeWorld(), app = makeApp(), w = makeWorker(world, app);
    await w.grab.registerMenu();
    await w.grab.onMenuClick({ menuItemId: 'hq-grab', srcUrl: 'https://alpha-site.test/a.jpg', pageUrl: PAGE, mediaType: 'image' }, { id: 3, url: PAGE });
    w.grab.install(); await w.grab.pump(); await w.grab.idle();
    world.items.set(99, { id: 99, state: 'in_progress' }); world.finish(99, 'complete');   // a download event with no job behind it
    assert.equal(w.guardCalls.length, 0);
    assert.equal(app.posts.length, 0);
  });

  test('after the click-made save finished: exactly one POST /library/grab through guardedFetch, with { path, pageUrl, pageTitle } and nothing else', async () => {
    const world = makeWorld(), app = makeApp(), w = makeWorker(world, app);
    await w.save(img('https://alpha-site.test/m/a.jpg'), { pageTitle: 'Acme poster launch day' });
    await w.grab.idle(); await settled(world);
    assert.equal(w.guardCalls.length, 1);
    const c = w.guardCalls[0];
    assert.deepEqual([c.p, c.init.method, c.jobStateAtCall], ['/library/grab', 'POST', 'saved'], 'the post follows the saved state');
    assert.deepEqual(c.cfg, { endpoint: 'http://127.0.0.1:47821', token: TOKEN });
    assert.deepEqual(app.posts[0].body, { path: SAVED_PATH, pageUrl: PAGE, pageTitle: 'Acme poster launch day' });
    assert.equal(app.posts[0].headers['Content-Type'], 'application/json');
    const j = world.queue()[0];
    assert.deepEqual([j.state, j.cosmos], ['saved', 'added']);
    assert.equal(w.rules.stateText(j), 'saved to Downloads/WorkspaceHQ/grabs/alpha-site.test/, and added to Cosmos');
  });

  test('a failed or canceled download posts nothing', async () => {
    for (const how of ['interrupted', 'canceled']) {
      const world = makeWorld(), app = makeApp(), w = makeWorker(world, app);
      world.outcome = () => how;
      await w.save(img('https://alpha-site.test/m/a.jpg'));
      await w.grab.idle(); await settled(world);
      assert.equal(world.queue()[0].state, 'failed', how);
      assert.equal(app.posts.length, 0, how);
    }
  });

  test('the job view the popup message returns carries no path and no page; stateText says nothing for a job Cosmos was never asked about', async () => {
    const world = makeWorld({ filenames: false }), app = makeApp(), w = makeWorker(world, app);
    const r = plain(await w.save(img('https://alpha-site.test/m/a.jpg')));
    assert.deepEqual(Object.keys(r.job).sort(), ['host', 'id', 'key', 'kind', 'message', 'state', 'tried']);
    await w.grab.idle(); await settled(world);
    const j = world.queue()[0];
    assert.deepEqual([j.state, j.savedPath, j.cosmos], ['saved', '', 'none'], 'no filename from Chrome: no post, no words');
    assert.equal(app.posts.length, 0);
    assert.equal(w.rules.stateText(j), 'saved to Downloads/WorkspaceHQ/grabs/alpha-site.test/');
  });

  test('one grab per message and per job: two saves post twice, each with its own path', async () => {
    const world = makeWorld(), app = makeApp(), w = makeWorker(world, app);
    await w.save(img('https://alpha-site.test/m/a.jpg'));
    await w.save(img('https://alpha-site.test/m/b.jpg'));
    await w.grab.idle(); await settled(world);
    assert.deepEqual(app.posts.map((p) => p.body.path.split('\\').pop()), ['a.jpg', 'b.jpg']);
  });
});

describe('the app says no, or is not there: the save stays saved', () => {
  const rows = [
    [409, 'refused: set it up first', 'saved to Downloads/WorkspaceHQ/grabs/alpha-site.test/; Cosmos says: set it up first'],
    [401, 'refused: pair the Bridge first', null],
    [403, 'refused: pair the Bridge first', null],
    [413, 'refused: too large for a clip', null],
    [415, 'refused: not a picture or video it keeps', null],
    [429, 'refused: too many grabs this hour', null],
    [404, 'refused: it could not find the file', null],
  ];
  for (const [status, words, text] of rows) {
    test(`HTTP ${status} -> "${words}"`, async () => {
      const world = makeWorld(), app = makeApp(), w = makeWorker(world, app);
      app.mode = 'status'; app.status = status;
      await w.save(img('https://alpha-site.test/m/a.jpg'));
      await w.grab.idle(); await settled(world);
      const j = world.queue()[0];
      assert.deepEqual([j.state, j.cosmos], ['saved', words]);
      assert.ok(w.rules.stateText(j).startsWith('saved to Downloads/'));
      if (text) assert.equal(w.rules.stateText(j), text);
      assert.match(w.rules.stateText(j), /; Cosmos says: /);
      assert.equal(app.posts.length, 1, 'a refusal is final: no retry loop');
    });
  }

  test('an app that is closed, a 5xx and an unreadable answer leave the job pending (honest words), saved all the same', async () => {
    for (const set of [(a) => { a.mode = 'down'; }, (a) => { a.mode = 'status'; a.status = 503; }, (a) => { a.mode = 'status'; a.status = 500; }, (a) => { a.mode = 'html'; }]) {
      const world = makeWorld(), app = makeApp(), w = makeWorker(world, app);
      set(app);
      await w.save(img('https://alpha-site.test/m/a.jpg'));
      await w.grab.idle(); await settled(world);
      const j = world.queue()[0];
      assert.deepEqual([j.state, j.cosmos], ['saved', 'pending']);
      assert.equal(w.rules.stateText(j), 'saved to Downloads/WorkspaceHQ/grabs/alpha-site.test/, Cosmos has not answered yet');
    }
  });

  test('not paired (no token): nothing leaves, the words say pair the Bridge', async () => {
    const world = makeWorld({ cfg: { endpoint: 'http://127.0.0.1:47821', token: '' } }), app = makeApp(), w = makeWorker(world, app);
    await w.save(img('https://alpha-site.test/m/a.jpg'));
    await w.grab.idle(); await settled(world);
    assert.equal(w.guardCalls.length, 0);
    assert.equal(world.queue()[0].cosmos, 'refused: pair the Bridge first');
    assert.equal(world.queue()[0].state, 'saved');
  });

  test('an endpoint that is not this PC: the guard throws not-on-pc, the words say so, nothing was sent', async () => {
    const world = makeWorld({ cfg: { endpoint: 'http://evil.test', token: TOKEN } }), app = makeApp();
    const sent = [];
    const w = makeWorker(world, app, { realGuard: async (u) => { sent.push(u); throw new Error('must not be called'); } });
    await w.save(img('https://alpha-site.test/m/a.jpg'));
    await w.grab.idle(); await settled(world);
    assert.equal(sent.length, 0);
    assert.equal(world.queue()[0].cosmos, 'refused: the endpoint is not on this PC');
    assert.equal(world.queue()[0].state, 'saved');
  });
});

describe('the real endpoint guard stands in front of the path', () => {
  const appFetchFor = (app, { impostor = false } = {}) => async (url, init = {}) => {
    const u = new URL(url);
    app.fetched = app.fetched || [];
    app.fetched.push([init.method || 'GET', u.pathname]);
    if (u.pathname === '/health') {
      const nonce = u.searchParams.get('nonce');
      const proof = createHmac('sha256', impostor ? 'f0'.repeat(32) : TOKEN).update(nonce).digest('hex');
      return { ok: true, status: 200, json: async () => ({ ok: true, app: 'workspacehq', proof }) };
    }
    return app.answer(init);
  };

  test('the app proves it holds the token first; then the POST carries X-HQ-Bridge and X-HQ-Token to 127.0.0.1', async () => {
    const world = makeWorld(), app = makeApp();
    const seen = [];
    const base = appFetchFor(app);
    const w = makeWorker(world, app, { realGuard: async (url, init) => { seen.push({ url, headers: init && init.headers }); return base(url, init); } });
    await w.save(img('https://alpha-site.test/m/a.jpg'));
    await w.grab.idle(); await settled(world);
    assert.deepEqual(app.fetched, [['GET', '/health'], ['POST', '/library/grab']], 'the proof comes first');
    const post = seen.find((s) => s.url.endsWith('/library/grab'));
    assert.equal(post.url, 'http://127.0.0.1:47821/library/grab');
    assert.equal(post.headers['X-HQ-Bridge'], '1');
    assert.equal(post.headers['X-HQ-Token'], TOKEN);
    assert.equal(world.queue()[0].cosmos, 'added');
  });

  test('an impostor on the port never receives the path: only the health probe is sent, the job stays pending', async () => {
    const world = makeWorld(), app = makeApp();
    const w = makeWorker(world, app, { realGuard: appFetchFor(app, { impostor: true }) });
    await w.save(img('https://alpha-site.test/m/a.jpg'));
    await w.grab.idle(); await settled(world);
    assert.deepEqual(app.fetched, [['GET', '/health']]);
    assert.equal(app.posts.length, 0, 'the body with the file path never left');
    assert.deepEqual([world.queue()[0].state, world.queue()[0].cosmos], ['saved', 'pending']);
  });
});

describe('a worker restart and the retry rules', () => {
  test('a restart re-posts only a job whose result is still pending, and the re-post is idempotent', async () => {
    const world = makeWorld(), app = makeApp();
    let w = makeWorker(world, app);
    app.mode = 'down';
    await w.save(img('https://alpha-site.test/m/a.jpg'));
    await w.grab.idle(); await settled(world);
    assert.equal(world.queue()[0].cosmos, 'pending');
    assert.equal(app.posts.length, 1);
    // the app is back; a new worker generation picks the queue up from storage
    app.mode = 'ok';
    world.t.v += 60_000;
    w = makeWorker(world, app);
    w.grab.install(); await w.grab.idle(); await settled(world);
    for (let i = 0; i < 40 && world.queue()[0].cosmos === 'pending'; i++) await tick();
    assert.equal(world.queue()[0].cosmos, 'added');
    assert.equal(app.posts.length, 2);
    assert.deepEqual(app.posts[1].body, app.posts[0].body, 'the same path again');
    // another restart: nothing is pending, nothing is posted
    w = makeWorker(world, app);
    w.grab.install(); await w.grab.idle(); await tick();
    assert.equal(app.posts.length, 2);
  });

  test('a duplicate answer is kept as "already in Cosmos"; refused, duplicate and added jobs are never re-posted', async () => {
    const world = makeWorld(), app = makeApp();
    app.seen.add(SAVED_PATH);
    let w = makeWorker(world, app);
    await w.save(img('https://alpha-site.test/m/a.jpg'));
    await w.grab.idle(); await settled(world);
    assert.equal(world.queue()[0].cosmos, 'duplicate');
    assert.equal(w.rules.stateText(world.queue()[0]), 'saved to Downloads/WorkspaceHQ/grabs/alpha-site.test/, already in Cosmos');
    for (const result of ['duplicate', 'added', 'refused: set it up first', 'none']) {
      const q = world.store.get('hq_grab_queue'); q.jobs[0].cosmos = result; world.store.set('hq_grab_queue', q);
      world.t.v += 600_000;
      w = makeWorker(world, app);
      w.grab.install(); await w.grab.idle(); await tick(); await tick();
    }
    assert.equal(app.posts.length, 1);
  });

  test('unrelated download events do not hammer a pending job: one retry per 20 seconds; after 24 hours it gives up with words', async () => {
    const world = makeWorld(), app = makeApp();
    const w = makeWorker(world, app);
    app.mode = 'down';
    await w.save(img('https://alpha-site.test/m/a.jpg'));
    await w.grab.idle(); await settled(world);
    assert.equal(app.posts.length, 1);
    for (let i = 0; i < 5; i++) { await w.grab.pump(); }
    assert.equal(app.posts.length, 1, 'within 20 s: no retry');
    world.t.v += 21_000;
    await w.grab.pump();
    assert.equal(app.posts.length, 2);
    world.t.v += 25 * 3600e3;
    await w.grab.pump();
    assert.equal(app.posts.length, 2, 'past 24 h it does not post again');
    assert.equal(world.queue()[0].cosmos, 'refused: Cosmos was not reachable');
    assert.equal(world.queue()[0].state, 'saved');
  });
});

describe('the words (grab-rules.js stateText)', () => {
  test('only a saved job gets Cosmos words; queued, saving and failed read as before', () => {
    const rules = makeWorker(makeWorld(), makeApp()).rules;
    const base = { host: 'alpha-site.test', tried: 1 };
    assert.equal(rules.stateText({ ...base, state: 'queued', cosmos: 'added' }), 'queued');
    assert.equal(rules.stateText({ ...base, state: 'saving', cosmos: 'pending' }), 'saving');
    assert.equal(rules.stateText({ ...base, state: 'failed', message: 'saving was canceled', cosmos: 'added' }), 'saving was canceled');
    assert.equal(rules.stateText({ ...base, state: 'saved' }), 'saved to Downloads/WorkspaceHQ/grabs/alpha-site.test/');
    assert.equal(rules.stateText({ ...base, state: 'saved', cosmos: 'none' }), 'saved to Downloads/WorkspaceHQ/grabs/alpha-site.test/');
    assert.equal(rules.stateText({ ...base, state: 'saved', cosmos: 'whatever' }), 'saved to Downloads/WorkspaceHQ/grabs/alpha-site.test/');
    assert.equal(rules.stateText({ ...base, state: 'saved', cosmos: 'refused: not a picture or video it keeps' }), 'saved to Downloads/WorkspaceHQ/grabs/alpha-site.test/; Cosmos says: not a picture or video it keeps');
  });
});
