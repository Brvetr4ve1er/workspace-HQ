// Bridge 0.7.0, stage 3: DOWNLOAD ON CLICK (the owner said yes on 2026-11-08: "the Bridge may download the image or video I click,
// and check the same site for a bigger version, only when I click"). The service-worker half (grab.js), the pure save rules
// (grab-rules.js) and the popup's Save button (grab-popup.js), run in node vms with a fake chrome (downloads, storage.session,
// alarms), a fake fetch that records every call, and a virtual clock. No network, no browser. Placeholder sites only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url));
const EXT = resolve(HERE, '..', 'browser-bridge');
const read = (f) => readFileSync(resolve(EXT, f), 'utf8');
const plain = (x) => JSON.parse(JSON.stringify(x));
const tick = () => new Promise((r) => setImmediate(r));

const POPUP_SENDER = { id: 'ext-abc', url: 'chrome-extension://ext-abc/popup.html' };
const PAGE = 'https://alpha-site.test/blog/post';
const STREAMED = 'streamed video — needs the video helper (not installed)';

// ---- a virtual clock: sleep(ms) resolves only when the driver advances time to it ------------------------------------------------
function makeClock(start = 5_000_000) {
  const c = { t: start, q: [] };
  c.now = () => c.t;
  c.sleep = (ms) => new Promise((r) => c.q.push({ at: c.t + ms, r }));
  // advance until cond() holds: run pending work first, move the clock only when everything is waiting on it
  c.until = async (cond, max = 4000) => {
    for (let i = 0; i < max; i++) {
      for (let k = 0; k < 6; k++) await tick();
      if (cond()) return true;
      if (c.q.length) { c.q.sort((a, b) => a.at - b.at); const x = c.q.shift(); c.t = Math.max(c.t, x.at); x.r(); }
    }
    return cond();
  };
  return c;
}

// ---- a fake chrome that outlives a "worker": storage and downloads are shared, listeners belong to one generation ---------------
function makeBrowser(clock) {
  const store = new Map();                       // chrome.storage.session
  const items = new Map();                       // chrome.downloads items
  const log = { downloads: [], fetches: [], alarms: [] };
  const gens = [];                               // one { listeners } per "worker"; only the newest is alive
  let nextId = 0;
  const cfg = {
    outcome: (url) => 'complete',                // 'complete' | 'interrupted' | 'hang' | 'canceled'
    throwFor: () => false,
    head: () => ({ ok: true, status: 200, type: 'basic', ct: 'image/jpeg' }),   // or { throws: true }
  };
  function chromeFor() {
    const gen = { listeners: [] }; gens.push(gen);
    return {
      storage: { session: {
        get: async (k) => (store.has(k) ? { [k]: structuredClone(store.get(k)) } : {}),
        set: async (o) => { for (const [k, v] of Object.entries(o)) store.set(k, structuredClone(v)); },
        remove: async (k) => { store.delete(k); },
      } },
      runtime: { id: 'ext-abc', getURL: (p) => 'chrome-extension://ext-abc/' + p },
      alarms: { create: (n, o) => log.alarms.push(['create', n, o]), clear: (n) => log.alarms.push(['clear', n]) },
      action: { setBadgeText: async () => {}, openPopup: async () => {} },
      contextMenus: { removeAll: (cb) => cb(), create: (o, cb) => cb && cb(), onClicked: { addListener() {} } },
      downloads: {
        download: async (opts) => {
          log.downloads.push({ ...plain(opts), at: clock.now() });
          if (cfg.throwFor(opts.url)) throw new Error('Invalid filename');
          const id = ++nextId;
          const it = { id, url: opts.url, state: 'in_progress', startTime: new Date(clock.now()).toISOString(), error: '' };
          items.set(id, it);
          const how = cfg.outcome(opts.url);
          if (how !== 'hang') setImmediate(() => browser.finish(id, how));
          return id;
        },
        search: async (q) => [...items.values()].filter((d) => (q.id == null || d.id === q.id) && (q.url == null || d.url === q.url)).map((d) => ({ ...d })),
        onChanged: { addListener: (f) => gen.listeners.push(f), removeListener: (f) => { const i = gen.listeners.indexOf(f); if (i >= 0) gen.listeners.splice(i, 1); } },
      },
    };
  }
  const browser = {
    store, items, log, cfg, gens, chromeFor,
    finish(id, how) {
      const it = items.get(id); if (!it || it.state !== 'in_progress') return;
      it.state = how === 'complete' ? 'complete' : 'interrupted';
      if (how !== 'complete') it.error = how === 'canceled' ? 'USER_CANCELED' : 'NETWORK_FAILED';
      const delta = { id, state: { current: it.state } };
      if (it.error) delta.error = { current: it.error };
      const live = gens[gens.length - 1];                 // a dead worker hears nothing
      if (live) live.listeners.slice().forEach((f) => f(delta));
    },
    fetch: async (url, init) => {
      log.fetches.push({ url, method: init && init.method, at: clock.now(), init });
      const h = cfg.head(url);
      if (h.throws) throw new TypeError('Failed to fetch');
      return { ok: h.ok, status: h.status, type: h.type || 'basic', headers: { get: (n) => (/content-type/i.test(n) ? h.ct || '' : null) } };
    },
    queue: () => (store.get('hq_grab_queue') || { jobs: [] }).jobs,
  };
  return browser;
}

// one "worker": grab-rules.js + grab.js over the shared fake browser
function worker(browser, clock) {
  const chrome = browser.chromeFor();
  const ctx = vm.createContext({ console, URL, AbortSignal: undefined });
  vm.runInContext(read('grab-rules.js'), ctx);
  vm.runInContext(read('grab.js'), ctx);
  const grab = ctx.HQGrab.create({ chrome, now: clock.now, sleep: clock.sleep, fetch: browser.fetch });
  return { grab, chrome, rules: ctx.HQGrabRules };
}
function setup() {
  const clock = makeClock(), browser = makeBrowser(clock), w = worker(browser, clock);
  const save = (entry, over = {}) => w.grab.enqueue({ type: 'grab:save', entry, pageUrl: PAGE, ...over }, over.sender || POPUP_SENDER);
  const settled = () => browser.queue().length > 0 && browser.queue().every((j) => j.state === 'saved' || j.state === 'failed');
  return { clock, browser, w, save, settled };
}
const img = (url, variants = [], kind = 'image') => ({ url, kind, variants });
const WP = 'https://alpha-site.test/wp-content/uploads/p-300x200.jpg';
const WP_BIG = 'https://alpha-site.test/wp-content/uploads/p.jpg';   // the guessed bigger version of WP

// ---- nothing happens before a click ---------------------------------------------------------------------------------------------
test('no network and no download before a click: a throwing fetch and download survive the menu, install, an empty pump and scanning', async () => {
  const { clock, browser, w } = setup();
  const calls = { fetch: 0, download: 0 };
  browser.fetch = async () => { calls.fetch++; throw new Error('no network before a click'); };
  const throwing = worker(browser, clock);   // a worker whose fetch is the throwing one
  const g = throwing.grab;
  const chrome = throwing.chrome;
  chrome.downloads.download = async () => { calls.download++; throw new Error('no download before a click'); };
  await g.registerMenu();
  await g.onMenuClick({ menuItemId: 'hq-grab', srcUrl: WP, pageUrl: PAGE, mediaType: 'image' }, { id: 3, url: PAGE });
  assert.ok(await g.takeTarget());
  g.install();
  await g.pump();
  await g.idle();
  assert.deepEqual(calls, { fetch: 0, download: 0 });
  assert.equal(browser.log.fetches.length, 0);
  assert.equal(browser.log.downloads.length, 0);
  assert.equal(w.grab.MIN_GAP_MS, 1000);
});

test('the popup scans and renders with no request and no message; only a press of Save sends the one message', async () => {
  const sent = [], calls = { fetch: 0, xhr: 0 };
  const chrome = {
    storage: { session: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
    tabs: { query: async () => [{ id: 7, url: PAGE }], get: async () => ({ id: 7, url: PAGE }) },
    action: { setBadgeText: async () => {} },
    scripting: { executeScript: async () => [{ result: { ok: true, items: [{ url: WP, kind: 'image', via: 'img', w: 300, h: 200, shownW: 150, shownH: 100, label: '', variants: [] }], streamed: 0 } }] },
    runtime: { sendMessage: async (m) => { sent.push(m); return { ok: true, job: { id: 'g1', state: 'queued' } }; } },
  };
  const ctx = vm.createContext({ URL, console, fetch: () => { calls.fetch++; throw new Error('no'); }, XMLHttpRequest: function () { calls.xhr++; throw new Error('no'); } });
  vm.runInContext(read('grab-rules.js'), ctx); vm.runInContext(read('grab-popup.js'), ctx);
  const pop = ctx.HQGrabPopup.create({ chrome, scan: function hqGrabScan() {} });
  const model = await pop.load();
  const { doc, host, buttons } = fakeDom();
  const view = pop.render(doc, host, model, { copy() {}, save: (row) => pop.save(row, model.pageUrl) });
  assert.equal(sent.length, 0, 'loading and rendering send nothing');
  assert.equal(calls.fetch + calls.xhr, 0);
  const save = buttons().find((b) => /^Save/.test(b.textContent));
  save.click(); save.click();                                   // a double click
  await tick();
  assert.equal(sent.length, 1, 'one press, one message (the button is spent until the job ends)');
  assert.equal(sent[0].type, 'grab:save');
  assert.ok(!Array.isArray(sent[0].entry), 'ONE entry');
  assert.equal(sent[0].entry.url, WP);
  assert.equal(sent[0].pageUrl, PAGE);
  assert.ok(view && typeof view.paint === 'function');
});

// ---- one click = one download ---------------------------------------------------------------------------------------------------
test('one click is one download, into Downloads/WorkspaceHQ/grabs/<host>/ with uniquify, no Save As and a safe name', async () => {
  const { clock, browser, save, settled } = setup();
  const r = await save(img('https://alpha-site.test/m/a.jpg'));
  assert.equal(r.ok, true); assert.equal(r.job.state, 'queued');
  assert.ok(await clock.until(settled));
  assert.equal(browser.log.downloads.length, 1);
  assert.deepEqual(browser.log.downloads[0], { url: 'https://alpha-site.test/m/a.jpg', filename: 'WorkspaceHQ/grabs/alpha-site.test/a.jpg', conflictAction: 'uniquify', saveAs: false, at: browser.log.downloads[0].at });
  assert.equal(browser.queue()[0].state, 'saved');
  assert.equal(browser.log.fetches.length, 0, 'the original is never HEAD-checked');
});

test('a second press on the same file while it waits is the same job, not a second download; a press after it finished is a new one', async () => {
  const { clock, browser, save, settled } = setup();
  const a = await save(img('https://alpha-site.test/m/a.jpg'));
  const b = await save(img('https://alpha-site.test/m/a.jpg#frag'));
  assert.equal(a.job.id, b.job.id);
  assert.ok(await clock.until(settled));
  assert.equal(browser.log.downloads.length, 1);
  const c = await save(img('https://alpha-site.test/m/a.jpg'));
  assert.notEqual(c.job.id, a.job.id);
  assert.ok(await clock.until(() => browser.queue().filter((j) => j.state === 'saved').length === 2));
  assert.equal(browser.log.downloads.length, 2);
});

test('there is no save-all: a message with a list, or an entries key, saves nothing; only the popup may ask', async () => {
  const { clock, browser, save, w } = setup();
  assert.deepEqual(plain(await save([img('https://alpha-site.test/m/a.jpg'), img('https://alpha-site.test/m/b.jpg')])), { ok: false, message: "Can't save this one" });
  assert.equal((await w.grab.enqueue({ type: 'grab:save', entries: [img('https://alpha-site.test/m/a.jpg')], pageUrl: PAGE }, POPUP_SENDER)).ok, false);
  assert.equal((await w.grab.enqueue({ type: 'grab:save', entry: { url: 5 } }, POPUP_SENDER)).ok, false);
  // a content script / web page, another extension, or a page of ours that is not the popup
  for (const sender of [{ id: 'ext-abc', url: PAGE, tab: { id: 1 } }, { id: 'someone-else', url: 'chrome-extension://ext-abc/popup.html' }, { id: 'ext-abc', url: 'chrome-extension://ext-abc/other.html' }, { id: 'ext-abc' }, undefined]) {
    assert.equal((await w.grab.enqueue({ type: 'grab:save', entry: img('https://alpha-site.test/m/a.jpg'), pageUrl: PAGE }, sender)).ok, false);
  }
  await clock.until(() => false, 30);
  assert.equal(browser.log.downloads.length, 0); assert.equal(browser.queue().length, 0);
});

test('no more than ten saves wait at once', async () => {
  const { browser, save, clock } = setup();
  browser.cfg.outcome = () => 'hang';
  for (let i = 0; i < 10; i++) assert.equal((await save(img('https://alpha-site.test/m/f' + i + '.jpg'))).ok, true);
  const r = await save(img('https://alpha-site.test/m/f10.jpg'));
  assert.equal(r.ok, false); assert.match(r.message, /Too many saves waiting/);
  await clock.until(() => false, 20);
});

// ---- pacing -------------------------------------------------------------------------------------------------------------------
test('at least 1 s between any two requests: three grabs queued together download 1 s apart, HEAD checks included', async () => {
  const { clock, browser, save } = setup();
  await save(img('https://alpha-site.test/m/a.jpg'));
  await save(img(WP));                                    // a guessed bigger version: HEAD, then download
  await save(img('https://alpha-site.test/m/c.jpg'));
  assert.ok(await clock.until(() => browser.queue().length === 3 && browser.queue().every((j) => j.state === 'saved')));
  const reqs = [...browser.log.downloads.map((d) => ({ at: d.at, what: 'download ' + d.url })), ...browser.log.fetches.map((f) => ({ at: f.at, what: 'head ' + f.url }))].sort((a, b) => a.at - b.at);
  assert.equal(reqs.length, 4);
  for (let i = 1; i < reqs.length; i++) assert.ok(reqs[i].at - reqs[i - 1].at >= 1000, `${reqs[i - 1].what} → ${reqs[i].what} only ${reqs[i].at - reqs[i - 1].at} ms apart`);
});

// ---- fall back down the list ---------------------------------------------------------------------------------------------------
test('a failed download falls back to the next candidate and the original is last; "tried N" counts them', async () => {
  const { clock, browser, save, settled } = setup();
  browser.cfg.outcome = (url) => (url === WP_BIG ? 'interrupted' : 'complete');
  await save(img(WP));
  assert.ok(await clock.until(settled));
  assert.deepEqual(browser.log.downloads.map((d) => d.url), [WP_BIG, WP]);
  const j = browser.queue()[0];
  assert.deepEqual([j.state, j.tried], ['saved', 2]);
});

test('every size failing says so: could not save (tried N sizes), and a throwing download() counts as a failed size', async () => {
  const { clock, browser, save, settled, w } = setup();
  browser.cfg.outcome = () => 'interrupted';
  await save(img(WP));
  assert.ok(await clock.until(settled));
  const j = browser.queue()[0];
  assert.equal(j.state, 'failed'); assert.equal(j.tried, 2);
  assert.equal(w.rules.stateText(j), 'could not save (tried 2 sizes)');
  assert.equal(w.rules.stateText({ state: 'failed', tried: 1 }), 'could not save (tried 1 size)');
  // download() itself refusing (a name Chrome rejects)
  browser.cfg.throwFor = () => true;
  await save(img('https://alpha-site.test/m/z.jpg'));
  assert.ok(await clock.until(() => browser.queue().length === 2 && browser.queue()[1].state === 'failed'));
  assert.equal(browser.queue()[1].tried, 1);
});

test('the owner canceling the download in Chrome ends the grab: no fallback to a smaller size', async () => {
  const { clock, browser, save, settled, w } = setup();
  browser.cfg.outcome = () => 'canceled';
  await save(img(WP));
  assert.ok(await clock.until(settled));
  assert.equal(browser.log.downloads.length, 1);
  const j = browser.queue()[0];
  assert.equal(j.state, 'failed'); assert.equal(w.rules.stateText(j), 'saving was canceled');
});

// ---- the HEAD check: the image's own host only, and only after the click ---------------------------------------------------------
test('HEAD only checks a guess on the image\'s own host; a page-offered variant on another host and the original are never HEAD-checked', async () => {
  const { clock, browser, save, settled } = setup();
  const e = img(WP, [{ url: 'https://cdn.beta.test/p-1600.jpg', w: 1600 }]);
  browser.cfg.outcome = (url) => (url === WP_BIG ? 'interrupted' : 'complete');
  assert.equal(browser.log.fetches.length, 0, 'nothing before the click');
  await save(e);
  assert.ok(await clock.until(settled));
  assert.deepEqual(browser.log.fetches.map((f) => [f.method, f.url]), [['HEAD', WP_BIG]]);
  assert.ok(browser.log.fetches.every((f) => new URL(f.url).hostname === 'alpha-site.test'));
  assert.deepEqual(browser.log.downloads.map((d) => d.url), [WP_BIG, 'https://cdn.beta.test/p-1600.jpg']);
  const init = browser.log.fetches[0].init;
  assert.deepEqual([init.credentials, init.redirect, init.referrerPolicy], ['omit', 'manual', 'no-referrer']);
  // the file went under the IMAGE's host, not the CDN's
  assert.equal(browser.log.downloads[1].filename, 'WorkspaceHQ/grabs/alpha-site.test/p-1600.jpg');
});

test('a guess that sits on a different host than the image (from a CDN variant) is not HEAD-checked at all', async () => {
  const { clock, browser, save, settled } = setup();
  await save(img('https://alpha-site.test/m/x.jpg', [{ url: 'https://cdn.beta.test/x.jpg?w=300', w: 300 }]));
  assert.ok(await clock.until(settled));
  assert.equal(browser.log.fetches.length, 0);
  assert.equal(browser.log.downloads[0].url, 'https://cdn.beta.test/x.jpg', 'the guess is tried straight away, the download itself being the check');
});

test('HEAD says missing, a redirect, or HTML: that size is skipped without a download; HEAD that cannot run (no permission) does not stop the save', async () => {
  for (const [head, expectDownloads] of [
    [{ ok: false, status: 404 }, [WP]],
    [{ ok: true, status: 200, type: 'opaqueredirect' }, [WP]],
    [{ ok: true, status: 200, ct: 'text/html' }, [WP]],
    [{ throws: true }, [WP_BIG]],
    [{ ok: true, status: 200, ct: 'image/webp' }, [WP_BIG]],
  ]) {
    const { clock, browser, save, settled } = setup();
    browser.cfg.head = () => head;
    await save(img(WP));
    assert.ok(await clock.until(settled), JSON.stringify(head));
    assert.deepEqual(browser.log.downloads.map((d) => d.url), expectDownloads, JSON.stringify(head));
    assert.equal(browser.queue()[0].state, 'saved');
  }
});

// ---- the queue survives a worker restart ----------------------------------------------------------------------------------------
test('a worker restart mid-download loses nothing: the new worker re-reads the queue, finishes the saving job, then the queued ones', async () => {
  const clock = makeClock(), browser = makeBrowser(clock);
  browser.cfg.outcome = (url) => (url.endsWith('/a.jpg') ? 'hang' : 'complete');
  const w1 = worker(browser, clock);
  await w1.grab.enqueue({ type: 'grab:save', entry: img('https://alpha-site.test/m/a.jpg'), pageUrl: PAGE }, POPUP_SENDER);
  await w1.grab.enqueue({ type: 'grab:save', entry: img('https://alpha-site.test/m/b.jpg'), pageUrl: PAGE }, POPUP_SENDER);
  assert.ok(await clock.until(() => browser.queue()[0] && browser.queue()[0].downloadId != null));
  assert.deepEqual(browser.queue().map((j) => j.state), ['saving', 'queued']);
  // the worker dies here: module state is gone, session storage and the download in Chrome are not
  const w2 = worker(browser, clock);
  w2.grab.install();                                      // top of background.js on the new worker: resumes the queue
  await clock.until(() => false, 20);
  assert.equal(browser.log.downloads.length, 1, 'the in-flight download is waited for, not started again');
  browser.finish(browser.queue()[0].downloadId, 'complete');
  assert.ok(await clock.until(() => browser.queue().every((j) => j.state === 'saved')));
  assert.deepEqual(browser.log.downloads.map((d) => d.url.split('/').pop()), ['a.jpg', 'b.jpg']);
  assert.ok(browser.log.alarms.some((a) => a[0] === 'create' && a[1] === 'hq-grab'), 'a pending save sets the wake-up alarm');
  assert.equal(browser.log.alarms[browser.log.alarms.length - 1][0], 'clear', 'and the alarm is cleared when the queue is empty');
});

test('a download that completed while the worker was gone is found finished, not started again', async () => {
  const clock = makeClock(), browser = makeBrowser(clock);
  browser.cfg.outcome = () => 'hang';
  const w1 = worker(browser, clock);
  await w1.grab.enqueue({ type: 'grab:save', entry: img('https://alpha-site.test/m/a.jpg'), pageUrl: PAGE }, POPUP_SENDER);
  assert.ok(await clock.until(() => browser.queue()[0] && browser.queue()[0].downloadId != null));
  browser.finish(browser.queue()[0].downloadId, 'complete');   // finished while no worker was listening
  const w2 = worker(browser, clock);
  await w2.grab.pump();
  assert.equal(browser.queue()[0].state, 'saved');
  assert.equal(browser.log.downloads.length, 1);
});

test('a download that Chrome started just before the worker died (its id never stored) is adopted, not repeated', async () => {
  const clock = makeClock(), browser = makeBrowser(clock);
  const w1 = worker(browser, clock);
  // simulate: attempt recorded, download() ran in Chrome, the worker died before the id was stored
  browser.store.set('hq_grab_queue', { v: 1, seq: 1, lastNetAt: clock.now(), jobs: [{ id: 'g1', key: 'https://alpha-site.test/m/a.jpg', host: 'alpha-site.test', kind: 'image', candidates: [{ url: 'https://alpha-site.test/m/a.jpg', guess: false }], idx: 0, tried: 0, state: 'saving', downloadId: null, attemptAt: clock.now(), attemptIdx: 0, message: '', at: clock.now() }] });
  browser.items.set(41, { id: 41, url: 'https://alpha-site.test/m/a.jpg', state: 'complete', startTime: new Date(clock.now() + 100).toISOString(), error: '' });
  const w2 = worker(browser, clock);
  await w2.grab.pump();
  assert.equal(browser.log.downloads.length, 0);
  assert.equal(browser.queue()[0].state, 'saved');
  void w1;
});

// ---- what may be saved --------------------------------------------------------------------------------------------------------------
test('blob: and streamed video say they need the video helper and start nothing; plain .mp4 .webm .mov save', async () => {
  const { clock, browser, save, settled, w } = setup();
  for (const [url, kind] of [['blob:https://alpha-site.test/1234-5678', 'video'], ['https://alpha-site.test/v/stream.m3u8', 'video'], ['https://alpha-site.test/v/manifest.mpd', 'video'], ['https://alpha-site.test/v/watch', 'video'], ['blob:https://alpha-site.test/9', 'image']]) {
    const r = await save(img(url, [], kind));
    assert.deepEqual(plain(r), { ok: false, message: STREAMED }, url);
  }
  assert.equal(browser.queue().length, 0);
  for (const name of ['clip.mp4', 'clip.webm', 'CLIP.MOV']) {
    const r = await save(img('https://alpha-site.test/v/' + name, [], 'video'));
    assert.equal(r.ok, true, name);
  }
  assert.ok(await clock.until(() => browser.queue().length === 3 && browser.queue().every((j) => j.state === 'saved')));
  assert.deepEqual(browser.log.downloads.map((d) => d.filename), ['WorkspaceHQ/grabs/alpha-site.test/clip.mp4', 'WorkspaceHQ/grabs/alpha-site.test/clip.webm', 'WorkspaceHQ/grabs/alpha-site.test/CLIP.mov']);
  assert.ok(settled());
  // a video's candidates are plain video files too
  assert.deepEqual(plain(w.rules.saveCandidates(img('https://alpha-site.test/v/a.mp4', [{ url: 'https://alpha-site.test/v/a.m3u8', w: 1920 }], 'video'))).map((c) => c.url), ['https://alpha-site.test/v/a.mp4']);
});

test('nothing is saved from Instagram, Facebook or TikTok: not the page, not the file host, not a variant', async () => {
  const { browser, save, w } = setup();
  const blocked = 'saving is off on Instagram, Facebook and TikTok';
  assert.equal((await save(img('https://alpha-site.test/m/a.jpg'), { pageUrl: 'https://www.instagram.com/p/abc/' })).message, blocked);
  assert.equal((await save(img('https://alpha-site.test/m/a.jpg'), { pageUrl: 'https://m.facebook.com/photo' })).message, blocked);
  assert.equal((await save(img('https://alpha-site.test/m/a.jpg'), { pageUrl: 'https://www.tiktok.com/@x/video/1' })).message, blocked);
  assert.equal((await save(img('https://scontent-xyz.cdninstagram.com/v/t51/a.jpg'))).message, blocked);
  assert.equal((await save(img('https://video.fbcdn.net/v/a.mp4', [], 'video'))).message, blocked);
  assert.equal((await save(img('https://v16.tiktokcdn.com/a.mp4', [], 'video'))).message, blocked);
  assert.equal(browser.queue().length, 0);
  assert.deepEqual(plain(w.rules.saveCandidates(img('https://alpha-site.test/m/a.jpg', [{ url: 'https://scontent.cdninstagram.com/a-big.jpg', w: 2000 }]))).map((c) => c.url), ['https://alpha-site.test/m/a.jpg']);
  // a look-alike is not blocked (the match is on a label boundary)
  assert.equal(w.rules.saveCheck(img('https://notinstagram.com/a.jpg')).ok, true);
  assert.equal(w.rules.saveCheck(img('https://alpha-site.test/a.jpg'), 'https://facebook.com.alpha-site.test/').ok, true);
});

test('file names are safe: no separators, no dot segments, no reserved Windows names, a bounded length, and the type kept', () => {
  const { w } = setup();
  const P = (host, url, kind = 'image') => w.rules.grabPath(host, url, kind);
  assert.equal(P('alpha-site.test', 'https://alpha-site.test/a/..%2F..%2Fevil.jpg'), 'WorkspaceHQ/grabs/alpha-site.test/_.._evil.jpg');
  assert.equal(P('alpha-site.test', 'https://alpha-site.test/CON.jpg'), 'WorkspaceHQ/grabs/alpha-site.test/image-CON.jpg');
  assert.equal(P('alpha-site.test', 'https://alpha-site.test/x/pic?format=png&name=orig'), 'WorkspaceHQ/grabs/alpha-site.test/pic.png');
  assert.equal(P('alpha-site.test', 'https://alpha-site.test/'), 'WorkspaceHQ/grabs/alpha-site.test/image');
  assert.equal(P('alpha-site.test', 'https://alpha-site.test/', 'video'), 'WorkspaceHQ/grabs/alpha-site.test/video');
  assert.equal(P('Alpha_Site.TEST:8080', 'https://alpha-site.test/a%5Cb%3Ac.JPG'), 'WorkspaceHQ/grabs/alphasite.test8080/a_b_c.jpg');
  for (const u of ['https://a.test/' + 'x'.repeat(400) + '.jpg', 'https://a.test/%00%1f?.jpg', 'https://a.test/ trailing.', 'https://a.test/..%5Cwin.jpg']) {
    const p = P('a.test', u), parts = p.split('/');
    assert.equal(parts.length, 4, p);
    assert.ok(parts[3].length <= 90, p);
    assert.ok(!/[<>:"\\|?*\u0000-\u001f]/.test(parts[3]) && !parts[3].startsWith('.') && !/[. ]$/.test(parts[3]), p);
    assert.ok(!parts.includes('..') && !parts.includes('.'), p);
  }
  assert.equal(P('::1', 'https://a.test/a.jpg').split('/')[2], '1');
  assert.equal(P('', 'https://a.test/a.jpg').split('/')[2], 'unknown-host');
});

// ---- the popup's Save button and the words ------------------------------------------------------------------------------------------
function fakeDom() {
  const all = [];
  const mk = (tag) => {
    const listeners = {};
    if (tag === 'img') throw new Error('an <img> would be a request');
    const n = { tag, className: '', textContent: '', dataset: {}, children: [], type: '', disabled: false,
      appendChild(c) { this.children.push(c); return c; }, replaceChildren() { this.children = []; },
      addEventListener(t, f) { listeners[t] = f; }, click() { listeners.click && listeners.click(); } };
    all.push(n); return n;
  };
  const doc = { createElement: mk };
  const host = mk('div');
  return { doc, host, buttons: () => all.filter((n) => n.tag === 'button'), states: () => all.filter((n) => /grab-state/.test(n.className)) };
}

function popupWith(items, tab = { id: 7, url: PAGE }) {
  const chrome = {
    storage: { session: { get: async () => ({}), set: async () => {}, remove: async () => {} } },
    tabs: { query: async () => [tab], get: async () => tab },
    action: { setBadgeText: async () => {} },
    scripting: { executeScript: async () => [{ result: { ok: true, items, streamed: 0 } }] },
    runtime: { sendMessage: async () => ({ ok: true }) },
  };
  const ctx = vm.createContext({ URL, console });
  vm.runInContext(read('grab-rules.js'), ctx); vm.runInContext(read('grab-popup.js'), ctx);
  return ctx.HQGrabPopup.create({ chrome, scan: function hqGrabScan() {} });
}
const scanItem = (url, kind = 'image', w = 900, h = 600) => ({ url, kind, via: 'img', w, h, shownW: 450, shownH: 300, label: '', variants: [] });

test('the page copy tells the truth: queued, saving, saved to Downloads/WorkspaceHQ/grabs/<host>/, could not save (tried N sizes)', async () => {
  const pop = popupWith([scanItem('https://alpha-site.test/m/a.jpg')]);
  const model = await pop.load();
  const d = fakeDom();
  const view = pop.render(d.doc, d.host, model, { save() {} });
  const key = 'https://alpha-site.test/m/a.jpg';
  const words = (job) => { view.paint(job ? [job] : []); return d.states()[0].textContent; };
  assert.equal(words(null), '');
  assert.equal(words({ key, host: 'alpha-site.test', state: 'queued' }), 'queued');
  assert.equal(words({ key, host: 'alpha-site.test', state: 'saving' }), 'saving');
  assert.equal(words({ key, host: 'alpha-site.test', state: 'saved' }), 'saved to Downloads/WorkspaceHQ/grabs/alpha-site.test/');
  assert.equal(words({ key, host: 'alpha-site.test', state: 'failed', tried: 3 }), 'could not save (tried 3 sizes)');
  const save = d.buttons().find((b) => /^Save/.test(b.textContent));
  view.paint([{ key, host: 'alpha-site.test', state: 'queued' }]); assert.equal(save.disabled, true, 'spent while the job waits');
  view.paint([{ key, host: 'alpha-site.test', state: 'saving' }]); assert.equal(save.disabled, true);
  view.paint([{ key, host: 'alpha-site.test', state: 'failed', tried: 1 }]); assert.equal(save.disabled, false, 'a failed one can be tried again');
  view.paint([{ key, host: 'alpha-site.test', state: 'saved' }]); assert.equal(save.disabled, false);
  view.paint([{ key: 'https://alpha-site.test/m/other.jpg', host: 'alpha-site.test', state: 'saved' }]);
  assert.equal(d.states()[0].textContent, '', 'another file\'s job says nothing about this row');
});

test('the popup shows the helper message instead of a Save button for streamed or blocked rows, and no row has a save-all', async () => {
  const pop = popupWith([scanItem('https://alpha-site.test/v/stream.m3u8', 'video', 1280, 720), scanItem('https://alpha-site.test/v/clip.mp4', 'video', 1280, 720), scanItem('https://alpha-site.test/m/a.jpg')]);
  const model = await pop.load();
  const d = fakeDom();
  pop.render(d.doc, d.host, model, { save() {} });
  const texts = d.states().map((n) => n.textContent);
  assert.ok(texts.includes(STREAMED));
  const saves = d.buttons().filter((b) => /^Save/.test(b.textContent));
  assert.equal(saves.length, 2, 'the streamed row has none');
  assert.ok(!d.buttons().some((b) => /\ball\b/i.test(b.textContent)));
  // on a blocked page every row says why and none has Save
  const pop2 = popupWith([scanItem('https://alpha-site.test/m/a.jpg')], { id: 7, url: 'https://www.instagram.com/p/x/' });
  const d2 = fakeDom();
  pop2.render(d2.doc, d2.host, await pop2.load(), { save() {} });
  assert.deepEqual(d2.states().map((n) => n.textContent), ['saving is off on Instagram, Facebook and TikTok']);
  assert.equal(d2.buttons().filter((b) => /^Save/.test(b.textContent)).length, 0);
});

// ---- wiring in the files --------------------------------------------------------------------------------------------------------------
test('wiring: one grab message type, the hq-grab alarm, the resume at the top of the worker, and the page note says where a click saves', () => {
  const bg = read('background.js');
  assert.deepEqual([...bg.matchAll(/type === 'grab:(\w+)'/g)].map((m) => m[1]), ['save']);
  assert.match(bg, /a\.name === HQGrab\.ALARM\) HQGrab\.pump\(\)/);
  assert.ok(bg.indexOf("importScripts('endpoint-guard.js', 'assist.js', 'grab-rules.js', 'grab.js')") >= 0);
  assert.match(bg, /\nHQGrab\.install\(\);/);
  const html = read('popup.html');
  assert.doesNotMatch(html, /save all|grab all|download all/i);
  const grabJs = read('grab.js').replace(/^\s*\/\/.*$/gm, '');
  assert.equal((grabJs.match(/downloads\.download\(/g) || []).length, 1, 'one place starts a download');
  assert.equal((grabJs.match(/method: 'HEAD'/g) || []).length, 1, 'one place asks the network, and it is a HEAD');
  assert.doesNotMatch(grabJs, /XMLHttpRequest|new Image\b|sendBeacon|WebSocket/);
  const rules = read('grab-rules.js');
  assert.match(rules, /Downloads\/WorkspaceHQ\/grabs\/<site>\//);
});
