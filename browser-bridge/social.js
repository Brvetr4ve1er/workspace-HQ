// SOCIAL BINDING — extension half. importScripts'd by background.js (classic SW).
//
// Reads your ALREADY-LOGGED-IN social tabs and ships what it finds to the local
// WorkspaceHQ app; executes posts you approved in the popup. The trick that keeps
// this robust and credential-free: each adapter's scrape/send runs INSIDE the tab
// (chrome.scripting, world:'MAIN'), so it reuses the site's own session + fetch
// under the site's own origin. The service worker never sees a token — it only
// relays results to 127.0.0.1. Adding a platform = one entry in SOCIAL_ADAPTERS.
//
// THE GATE: this half only SENDS when socialSend() is called, and that only
// happens from a human clicking "Approve & Send" in the popup. The periodic tick
// is read-only (scrape -> /ingest/social). Nothing here can auto-publish.

/* global chrome */

const SOCIAL_ALARM = 'social';
const SOCIAL_PERIOD_MIN = 5;
const SOCIAL_DEFAULTS = { endpoint: 'http://127.0.0.1:47821', token: '', paused: false };

async function socialCfg() {
  const { hq_cfg } = await chrome.storage.local.get('hq_cfg');
  return { ...SOCIAL_DEFAULTS, ...(hq_cfg || {}) };
}
function socialHeaders(cfg, post) {
  return { ...(post ? { 'Content-Type': 'application/json' } : {}), 'X-HQ-Bridge': '1', ...(cfg.token ? { 'X-HQ-Token': cfg.token } : {}) };
}
async function socialSendToApp(route, body) {
  const cfg = await socialCfg();
  return fetch(cfg.endpoint.replace(/\/$/, '') + route, { method: 'POST', headers: socialHeaders(cfg, true), body: JSON.stringify(body) });
}
async function socialGetFromApp(route) {
  const cfg = await socialCfg();
  return fetch(cfg.endpoint.replace(/\/$/, '') + route, { headers: socialHeaders(cfg, false) }).then((r) => r.json());
}

// ---- injected page functions (must be self-contained — no outer refs) ------
// These run in the bsky.app tab's MAIN world. Bluesky stores its session in
// localStorage; the shape has drifted across releases, so we scan for any value
// carrying an accessJwt rather than hard-coding a key.
function bskyReadSession() {
  for (let i = 0; i < localStorage.length; i++) {
    const raw = localStorage.getItem(localStorage.key(i));
    if (!raw || raw.indexOf('accessJwt') === -1) continue;
    try {
      const o = JSON.parse(raw);
      const cand = o.session || (o.accounts && o.accounts[0]) || o.currentAccount || o;
      const s = cand && cand.session ? cand.session : cand;
      if (s && s.accessJwt) return { accessJwt: s.accessJwt, did: s.did, handle: s.handle, pds: s.pdsUrl || s.service || 'https://bsky.social' };
    } catch (e) { /* not this key */ }
  }
  return null;
}

async function bskyScrapeInPage() {
  const sess = bskyReadSession();
  if (!sess) return { ok: false, error: 'no Bluesky session found — are you logged in at bsky.app?' };
  const H = { authorization: 'Bearer ' + sess.accessJwt };
  const now = Date.now();
  const events = [];
  const postUrl = (handle, uri) => 'https://bsky.app/profile/' + handle + '/post/' + String(uri).split('/').pop();
  try {
    const tl = await fetch(sess.pds + '/xrpc/app.bsky.feed.getTimeline?limit=30', { headers: H }).then((r) => r.json());
    for (const it of (tl.feed || [])) {
      const p = it.post; if (!p) continue;
      const h = (p.author && p.author.handle) || '';
      events.push({ platform: 'bluesky', kind: 'feed', id: p.uri, ts: Date.parse(p.indexedAt) || now, author: '@' + h, text: (p.record && p.record.text) || '', url: postUrl(h, p.uri), uri: p.uri, counts: { likes: p.likeCount || 0, reposts: p.repostCount || 0, replies: p.replyCount || 0 } });
    }
  } catch (e) { /* timeline unavailable */ }
  try {
    const nt = await fetch(sess.pds + '/xrpc/app.bsky.notification.listNotifications?limit=30', { headers: H }).then((r) => r.json());
    for (const n of (nt.notifications || [])) {
      const h = (n.author && n.author.handle) || '';
      const kind = (n.reason === 'mention' || n.reason === 'reply') ? 'mention' : 'notification';
      events.push({ platform: 'bluesky', kind, id: n.uri || n.cid, ts: Date.parse(n.indexedAt) || now, author: '@' + h, text: (n.record && n.record.text) || n.reason || '', url: 'https://bsky.app/profile/' + h, uri: n.uri || '' });
    }
  } catch (e) { /* notifications unavailable */ }
  let account = null;
  try {
    const me = await fetch(sess.pds + '/xrpc/app.bsky.actor.getProfile?actor=' + encodeURIComponent(sess.did || sess.handle), { headers: H }).then((r) => r.json());
    if (me && me.handle) {
      account = { platform: 'bluesky', handle: '@' + me.handle, display: me.displayName || '' };
      events.push({ platform: 'bluesky', kind: 'metrics', id: 'metrics', ts: now, metrics: { followers: me.followersCount || 0, following: me.followsCount || 0, posts: me.postsCount || 0 } });
    }
  } catch (e) { /* profile unavailable */ }
  return { ok: true, events, account };
}

async function bskySendInPage(action) {
  const sess = bskyReadSession();
  if (!sess) return { ok: false, error: 'no Bluesky session (log in at bsky.app)' };
  const H = { 'content-type': 'application/json', authorization: 'Bearer ' + sess.accessJwt };
  const record = { $type: 'app.bsky.feed.post', text: String(action.text || ''), createdAt: new Date().toISOString() };
  if (action.op === 'reply' && action.reply_to) {
    try {
      const got = await fetch(sess.pds + '/xrpc/app.bsky.feed.getPosts?uris=' + encodeURIComponent(action.reply_to), { headers: { authorization: 'Bearer ' + sess.accessJwt } }).then((r) => r.json());
      const p = got && got.posts && got.posts[0];
      if (p && p.cid) { const ref = { uri: p.uri, cid: p.cid }; record.reply = { root: ref, parent: ref }; }
    } catch (e) { /* fall through: posts as top-level if we can't resolve the parent */ }
  }
  try {
    const res = await fetch(sess.pds + '/xrpc/com.atproto.repo.createRecord', { method: 'POST', headers: H, body: JSON.stringify({ repo: sess.did, collection: 'app.bsky.feed.post', record }) }).then((r) => r.json());
    if (res && res.uri) return { ok: true, uri: res.uri, url: 'https://bsky.app/profile/' + (sess.handle || sess.did) + '/post/' + String(res.uri).split('/').pop() };
    return { ok: false, error: (res && (res.message || res.error)) || 'createRecord failed' };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

// ---- adapter registry ------------------------------------------------------
const SOCIAL_ADAPTERS = {
  bluesky: { match: (url) => /^https:\/\/bsky\.app\//.test(url || ''), scrape: bskyScrapeInPage, send: bskySendInPage },
  // Phase 2+: mastodon, reddit, x, … each is { match, scrape, send } and one
  // host_permissions entry in manifest.json.
};

async function firstTabFor(adapter) {
  const tabs = await chrome.tabs.query({});
  return tabs.find((t) => adapter.match(t.url)) || null;
}
async function runInTab(tabId, func, args) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func, args: args || [] });
  return r && r.result;
}

// Periodic READ pass: scrape every open, logged-in social tab into the app.
async function socialTick() {
  const cfg = await socialCfg();
  if (cfg.paused) return;
  const accounts = [];
  for (const [platform, ad] of Object.entries(SOCIAL_ADAPTERS)) {
    const tab = await firstTabFor(ad);
    if (!tab) continue;
    let out;
    try { out = await runInTab(tab.id, ad.scrape); } catch (e) { continue; }   // tab closed / injection blocked
    if (!out || !out.ok) continue;
    if (out.events && out.events.length) await socialSendToApp('/ingest/social', { v: 1, events: out.events }).catch(() => {});
    if (out.account) accounts.push(out.account);
  }
  if (accounts.length) await socialSendToApp('/social/accounts', { accounts }).catch(() => {});
}

// WRITE pass: only ever called for an action the human approved in the popup.
async function socialSend(action) {
  const ad = SOCIAL_ADAPTERS[action && action.platform];
  if (!ad) return { ok: false, error: 'no adapter for ' + (action && action.platform) };
  const tab = await firstTabFor(ad);
  if (!tab) return { ok: false, error: 'open a logged-in ' + action.platform + ' tab first' };
  let res;
  try { res = await runInTab(tab.id, ad.send, [action]); } catch (e) { res = { ok: false, error: String((e && e.message) || e) }; }
  res = res || { ok: false, error: 'no result from adapter' };
  await socialSendToApp('/social/outbox/result', { id: action.id, ok: !!res.ok, url: res.url, uri: res.uri, error: res.error }).catch(() => {});
  return res;
}
