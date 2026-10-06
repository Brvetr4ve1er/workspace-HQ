// browser-bridge/popup.js: the approval card. The card must only ever show,
// and enable, a post the human chose to look at:
//  - When the post on screen is canceled, sent or edited from outside the popup
//    (MCP hq_social_cancel, another browser profile), the poll must NOT swap the
//    next post in, enabled, under a click that was aimed at the first one. The
//    card hides and locks behind "handled elsewhere · show next" until the human
//    clicks. socialSend can't catch this: the post that would take its place is
//    staged and unchanged.
//  - A post that lands on the card without the human paging to it is armed only
//    after ARM_MS.
//
// popup.js is a classic extension page script. It runs here in a vm context with
// a fake DOM parsed from popup.html, plus a fake chrome, fetch and virtual timers.
// No browser, no port, no real extension.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';

const HERE = dirname(fileURLToPath(import.meta.url)); // dashboard/ — never cwd
const EXT = resolve(HERE, '..', 'browser-bridge');
const POPUP_JS = readFileSync(resolve(EXT, 'popup.js'), 'utf8');
const POPUP_HTML = readFileSync(resolve(EXT, 'popup.html'), 'utf8');

// ---- fake DOM: every element with an id, its static `hidden`, and its id'd ancestors
const VOID = new Set(['meta', 'link', 'input', 'br', 'img', 'hr']);
function parseIds(html) {
  const out = new Map();
  const stack = [];
  const src = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<!doctype[^>]*>/i, '');
  for (const m of src.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
    const [, close, tag, attrs] = m;
    if (close) { while (stack.length && stack.pop().tag !== tag.toLowerCase()); continue; }
    const id = (attrs.match(/\bid="([^"]+)"/) || [])[1] || null;
    if (id) out.set(id, { hidden: /(?:^|\s)hidden(?=\s|$|=|\/)/.test(attrs), parents: stack.filter((s) => s.id).map((s) => s.id) });
    if (!VOID.has(tag.toLowerCase())) stack.push({ tag: tag.toLowerCase(), id });
  }
  return out;
}
const IDS = parseIds(POPUP_HTML);

function makeDom() {
  const els = new Map();
  for (const [id, { hidden }] of IDS) {
    const listeners = {};
    els.set(id, {
      id, hidden, disabled: false, textContent: '', value: '', checked: false, scrollTop: 0, dataset: {},
      addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
      fire(type) { return Promise.all((listeners[type] || []).map((fn) => fn({ target: this }))); },
    });
  }
  const document = {
    getElementById(id) {
      const el = els.get(id);
      if (!el) throw new Error(`popup.js asked for #${id}, which popup.html doesn't have`);
      return el;
    },
  };
  return { els, document };
}

// ---- the app as the popup sees it
const A = { id: 'act-a', platform: 'bluesky', op: 'post', text: 'post A — the one on screen', status: 'staged', staged_at: '2026-01-01T00:00:00.000Z', by: 'claude' };
const B = { id: 'act-b', platform: 'mastodon', op: 'post', text: 'post B — never read by the human', status: 'staged', staged_at: '2026-01-01T00:01:00.000Z', by: 'claude' };
const C = { id: 'act-c', platform: 'reddit', op: 'post', target: 'example', title: 'post C', text: 'post C body', status: 'staged', staged_at: '2026-01-01T00:02:00.000Z', by: 'claude' };

async function openPopup(outbox) {
  const env = {
    outbox: outbox.map((a) => ({ ...a })),
    outboxError: false,
    gate: null,           // a promise: the next outbox GET answers (with what it read) only once it resolves
    sends: [],            // social:send messages the service worker received
    cancels: [],          // ids POSTed to /social/outbox/cancel
  };
  // virtual timers
  let now = 0, seq = 0;
  const timers = new Map();
  const setTimeout = (fn, ms = 0) => { const id = ++seq; timers.set(id, { fn, due: now + ms }); return id; };
  const clearTimeout = (id) => { timers.delete(id); };
  const setInterval = () => ++seq;   // the poll is driven by the test (poll())
  const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r)); };
  async function advance(ms) {
    const end = now + ms;
    for (;;) {
      await flush();
      let next = null;
      for (const [id, t] of timers) if (t.due <= end && (!next || t.due < next[1].due)) next = [id, t];
      if (!next) break;
      timers.delete(next[0]);
      now = Math.max(now, next[1].due);
      next[1].fn();
    }
    now = end;
    await flush();
  }

  const reply = (status, body) => ({ status, json: async () => body });
  async function fetch(url, opts = {}) {
    const path = new URL(url).pathname;
    const method = opts.method || 'GET';
    if (path === '/health') return reply(200, { ok: true, app: 'workspacehq', needsToken: false });
    if (path === '/social/outbox' && method === 'GET') {
      const snapshot = env.outbox.map((a) => ({ ...a }));   // what the app had when asked
      const error = env.outboxError;
      if (env.gate) { const g = env.gate; env.gate = null; await g; }
      return error ? reply(500, { ok: false, error: 'outbox unreadable' }) : reply(200, { ok: true, actions: snapshot });
    }
    if (path === '/social/outbox/cancel' && method === 'POST') {
      const { id } = JSON.parse(opts.body);
      env.cancels.push(id);
      env.outbox = env.outbox.filter((a) => a.id !== id);
      return reply(200, { ok: true, id, status: 'canceled' });
    }
    throw new Error('unexpected fetch ' + method + ' ' + url);
  }
  const chrome = {
    storage: { local: {
      get: async () => ({ hq_cfg: { endpoint: 'http://127.0.0.1:1', paused: false, token: '' }, hq_state: {} }),
      set: async () => {},
    } },
    runtime: { sendMessage: async (msg) => {
      if (msg.type !== 'social:send') return {};
      env.sends.push(msg.action);
      env.outbox = env.outbox.filter((a) => a.id !== msg.action.id);
      return { ok: true, url: 'https://example.org/p/1' };
    } },
    permissions: { request: async () => false },
  };

  const { els, document } = makeDom();
  const ctx = vm.createContext({ chrome, fetch, document, setTimeout, clearTimeout, setInterval, AbortController, URL, console });
  vm.runInContext(POPUP_JS, ctx, { filename: 'popup.js' });
  await advance(0);

  const $ = (id) => els.get(id);
  const visible = (id) => !$(id).hidden && IDS.get(id).parents.every((p) => !$(p).hidden);
  const clickable = (id) => visible(id) && !$(id).disabled;
  return {
    env, $, visible, clickable, advance, flush,
    ui: vm.runInContext('ui', ctx),
    ARM_MS: vm.runInContext('ARM_MS', ctx),
    // a human click: only lands on a visible, enabled button
    click(id) {
      assert.ok(clickable(id), `#${id} is not clickable (visible ${visible(id)}, disabled ${$(id).disabled})`);
      return $(id).fire('click');
    },
    // the listener itself, as if the click got through anyway (handler guards)
    force: (id) => $(id).fire('click'),
    async poll() { await vm.runInContext('refresh()', ctx); await flush(); },
    cardText: () => (visible('card') ? $('c-text').textContent : null),
  };
}

test('every element popup.js reads exists in popup.html', () => {
  const used = new Set([...POPUP_JS.matchAll(/\$\('([\w-]+)'\)/g)].map((m) => m[1]));
  assert.ok(used.has('held') && used.has('held-show') && used.has('held-msg'));
  assert.deepEqual([...used].filter((id) => !IDS.has(id)).sort(), []);
});

test('the held notice sits above the card and is hidden by default', () => {
  assert.equal(IDS.get('held').hidden, true);
  assert.deepEqual(IDS.get('held-show').parents.slice(-2), ['appr', 'held']);
  assert.ok(POPUP_HTML.indexOf('id="held"') < POPUP_HTML.indexOf('id="card"'));
});

test('a post canceled elsewhere while on screen: the next one is NOT swapped in — the card locks until "show next"', async () => {
  const p = await openPopup([A, B]);
  await p.advance(p.ARM_MS);
  assert.equal(p.cardText(), A.text);
  assert.ok(p.clickable('approve'));

  // the agent cancels its own post (MCP hq_social_cancel) while the human reads it
  p.env.outbox = p.env.outbox.filter((a) => a.id !== A.id);
  await p.poll();

  assert.equal(p.cardText(), null, 'post B must not be on the card');
  assert.ok(p.visible('held'));
  assert.match(p.$('held-msg').textContent, /handled elsewhere/);
  assert.equal(p.$('held-show').textContent, 'show next');
  assert.equal(p.clickable('approve'), false);
  assert.equal(p.clickable('skip'), false);
  assert.equal(p.ui.shown, null);
  // even if a click got through to the handlers, nothing is sent or canceled
  await p.force('approve');
  await p.force('skip');
  await p.force('next');
  assert.deepEqual(p.env.sends, []);
  assert.deepEqual(p.env.cancels, []);
  assert.equal(p.cardText(), null);

  // more polls and time do not release it
  await p.poll();
  await p.advance(p.ARM_MS * 5);
  assert.equal(p.cardText(), null);
  assert.ok(p.visible('held'));

  // only the explicit click shows B, and approve arms after ARM_MS
  await p.click('held-show');
  assert.equal(p.cardText(), B.text);
  assert.equal(p.visible('held'), false);
  assert.equal(p.clickable('approve'), false, 'approve must not be live the instant B appears');
  await p.force('approve');
  assert.deepEqual(p.env.sends, []);
  await p.advance(p.ARM_MS);
  assert.ok(p.clickable('approve'));

  const sending = p.click('approve');
  await p.advance(800);
  await sending;
  assert.deepEqual(p.env.sends.map((a) => a.id), [B.id]);
});

test('a post edited in place while on screen: the new text only appears after "show the new version"', async () => {
  const p = await openPopup([A]);
  await p.advance(p.ARM_MS);
  assert.equal(p.cardText(), A.text);

  p.env.outbox = [{ ...A, text: 'post A, quietly rewritten' }];
  await p.poll();
  assert.equal(p.cardText(), null);
  assert.match(p.$('held-msg').textContent, /changed/);
  assert.equal(p.$('held-show').textContent, 'show the new version');
  await p.force('approve');
  assert.deepEqual(p.env.sends, []);

  await p.click('held-show');
  assert.equal(p.cardText(), 'post A, quietly rewritten');
  assert.equal(p.clickable('approve'), false);
  await p.advance(p.ARM_MS);
  assert.ok(p.clickable('approve'));
});

test('the human\'s own skip advances to the next post (no hold), and approve re-arms', async () => {
  const p = await openPopup([A, B]);
  await p.advance(p.ARM_MS);

  const skipping = p.click('skip');
  await p.flush();
  assert.equal(p.clickable('approve'), false, 'locked while the skip is in flight');
  await p.advance(800);
  await skipping;

  assert.deepEqual(p.env.cancels, [A.id]);
  assert.equal(p.visible('held'), false);
  assert.equal(p.cardText(), B.text);
  assert.equal(p.clickable('approve'), false);
  await p.advance(p.ARM_MS);
  assert.ok(p.clickable('approve'));
  assert.deepEqual(p.env.sends, []);
});

test('a poll that read the outbox before the human\'s send lands can\'t show the stale list or raise a false hold', async () => {
  const p = await openPopup([A, B]);
  await p.advance(p.ARM_MS);

  let release;
  p.env.gate = new Promise((r) => { release = r; });
  const stalePoll = p.poll();   // reads [A, B], answers only on release()
  await p.flush();

  const sending = p.click('approve');
  await p.advance(700);         // settle's wait is over; the stale poll is still out
  release();
  await stalePoll;
  assert.equal(p.cardText(), A.text, 'card still locked on A while busy');
  assert.equal(p.clickable('approve'), false);

  await p.advance(200);
  await sending;
  assert.deepEqual(p.env.sends.map((a) => a.id), [A.id]);
  assert.equal(p.visible('held'), false, 'the human sent A: no "handled elsewhere"');
  assert.equal(p.cardText(), B.text);
  assert.equal(p.clickable('approve'), false);
  await p.advance(p.ARM_MS);
  assert.ok(p.clickable('approve'));
});

test('an outbox read error in between does not launder the swap: still held when the list comes back without the post', async () => {
  const p = await openPopup([A, B]);
  await p.advance(p.ARM_MS);

  p.env.outboxError = true;
  await p.poll();
  assert.equal(p.cardText(), null);
  assert.match(p.$('appr-empty').textContent, /could not read the outbox/);

  p.env.outboxError = false;
  p.env.outbox = [{ ...B }];
  await p.poll();
  assert.equal(p.cardText(), null);
  assert.ok(p.visible('held'));
  assert.equal(p.clickable('approve'), false);
});

test('an outbox read error with the post still staged: the same post comes back (no hold)', async () => {
  const p = await openPopup([A, B]);
  await p.advance(p.ARM_MS);
  p.env.outboxError = true;
  await p.poll();
  p.env.outboxError = false;
  await p.poll();
  assert.equal(p.visible('held'), false);
  assert.equal(p.cardText(), A.text);
});

test('the post on screen handled elsewhere and nothing left: "nothing staged" + a note; a later post arrives armed', async () => {
  const p = await openPopup([A]);
  await p.advance(p.ARM_MS);

  p.env.outbox = [];
  await p.poll();
  assert.equal(p.cardText(), null);
  assert.equal(p.visible('held'), false);
  assert.equal(p.$('appr-empty').textContent, 'nothing staged');
  assert.match(p.$('c-status').textContent, /handled elsewhere/);

  p.env.outbox = [{ ...C }];
  await p.poll();
  assert.equal(p.visible('held'), false);
  assert.equal(p.$('c-title').textContent, C.title);
  assert.equal(p.cardText(), C.text);
  assert.equal(p.clickable('approve'), false);
  await p.advance(p.ARM_MS);
  assert.ok(p.clickable('approve'));
});

test('opening the popup: the first post is shown, approve arms after ARM_MS', async () => {
  const p = await openPopup([A, B]);
  assert.equal(p.cardText(), A.text);
  assert.equal(p.$('appr-k').textContent, 'awaiting approval · 1 of 2');
  assert.equal(p.clickable('approve'), false);
  await p.force('approve');
  assert.deepEqual(p.env.sends, []);
  await p.advance(p.ARM_MS);
  assert.ok(p.clickable('approve'));
});

test('paging with ‹ › shows the chosen post at once and leaves it live; an unchanged poll leaves the card alone', async () => {
  const p = await openPopup([A, B, C]);
  await p.advance(p.ARM_MS);

  await p.click('next');
  assert.equal(p.cardText(), B.text);
  assert.equal(p.$('appr-k').textContent, 'awaiting approval · 2 of 3');
  assert.ok(p.clickable('approve'), 'the human picked B: no arming delay');

  await p.poll();
  assert.equal(p.cardText(), B.text);
  assert.equal(p.visible('held'), false);
  assert.ok(p.clickable('approve'));

  await p.click('prev');
  assert.equal(p.cardText(), A.text);
});

test('another post leaving the list (not the one on screen) keeps the card live on the same post', async () => {
  const p = await openPopup([A, B, C]);
  await p.advance(p.ARM_MS);
  await p.click('next');   // on B
  p.env.outbox = p.env.outbox.filter((a) => a.id !== A.id);
  await p.poll();
  assert.equal(p.visible('held'), false);
  assert.equal(p.cardText(), B.text);
  assert.equal(p.$('appr-k').textContent, 'awaiting approval · 1 of 2');
  assert.ok(p.clickable('approve'));
});
