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

// ---- Mastodon (federated; token in the page's initial-state JSON) ----------
function mastoToken() {
  try { const el = document.getElementById('initial-state'); if (el) { const s = JSON.parse(el.textContent); return (s.meta && s.meta.access_token) || null; } } catch (e) { /* not a masto page */ }
  return null;
}
async function mastoScrapeInPage() {
  const t = mastoToken();
  if (!t) return { ok: false, error: 'no Mastodon session — open your instance logged in' };
  const base = location.origin;
  const H = { authorization: 'Bearer ' + t };
  const now = Date.now();
  const events = [];
  // Mastodon content is HTML — strip to text via DOMParser (inert document: no
  // script execution and no <img onerror>/resource side-effects, unlike innerHTML).
  const strip = (html) => { try { return new DOMParser().parseFromString(html || '', 'text/html').body.textContent || ''; } catch (e) { return ''; } };
  try {
    const tl = await fetch(base + '/api/v1/timelines/home?limit=30', { headers: H }).then((r) => r.json());
    for (const s of (Array.isArray(tl) ? tl : [])) {
      events.push({ platform: 'mastodon', kind: 'feed', id: s.id, ts: Date.parse(s.created_at) || now, author: '@' + ((s.account && s.account.acct) || ''), text: strip(s.content), url: s.url || s.uri, uri: s.uri || '', counts: { likes: s.favourites_count || 0, reposts: s.reblogs_count || 0, replies: s.replies_count || 0 } });
    }
  } catch (e) { /* timeline unavailable */ }
  try {
    const nt = await fetch(base + '/api/v1/notifications?limit=30', { headers: H }).then((r) => r.json());
    for (const n of (Array.isArray(nt) ? nt : [])) {
      const kind = n.type === 'mention' ? 'mention' : 'notification';
      const s = n.status;
      events.push({ platform: 'mastodon', kind, id: n.id, ts: Date.parse(n.created_at) || now, author: '@' + ((n.account && n.account.acct) || ''), text: s ? strip(s.content) : (n.type || ''), url: s ? s.url : '', uri: s ? s.uri : '' });
    }
  } catch (e) { /* notifications unavailable */ }
  let account = null;
  try {
    const me = await fetch(base + '/api/v1/accounts/verify_credentials', { headers: H }).then((r) => r.json());
    if (me && me.acct) {
      account = { platform: 'mastodon', handle: '@' + me.acct, display: me.display_name || '' };
      events.push({ platform: 'mastodon', kind: 'metrics', id: 'metrics', ts: now, metrics: { followers: me.followers_count || 0, following: me.following_count || 0, posts: me.statuses_count || 0 } });
    }
  } catch (e) { /* profile unavailable */ }
  return { ok: true, events, account };
}
async function mastoSendInPage(action) {
  const t = mastoToken();
  if (!t) return { ok: false, error: 'no Mastodon session' };
  const body = { status: String(action.text || '') };
  if (action.op === 'reply' && action.reply_to) body.in_reply_to_id = String(action.reply_to).split('/').pop();
  try {
    const res = await fetch(location.origin + '/api/v1/statuses', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + t }, body: JSON.stringify(body) }).then((r) => r.json());
    if (res && res.id) return { ok: true, uri: res.uri, url: res.url };
    return { ok: false, error: (res && res.error) || 'post failed' };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

// ---- Reddit (session-cookie only; JSON endpoints + modhash for writes) ------
async function redditScrapeInPage() {
  const base = location.origin;
  const now = Date.now();
  const events = [];
  const J = (u) => fetch(u, { credentials: 'include', headers: { accept: 'application/json' } }).then((r) => r.json());
  try {
    const home = await J(base + '/.json?limit=30');
    for (const c of ((home && home.data && home.data.children) || [])) {
      const d = c.data; if (!d) continue;
      events.push({ platform: 'reddit', kind: 'feed', id: d.name, ts: d.created_utc ? d.created_utc * 1000 : now, author: 'u/' + (d.author || ''), text: d.title || '', url: 'https://www.reddit.com' + (d.permalink || ''), uri: d.name || '', counts: { likes: d.ups || 0, reposts: 0, replies: d.num_comments || 0 } });
    }
  } catch (e) { /* home unavailable */ }
  try {
    const inbox = await J(base + '/message/inbox.json?limit=30');
    for (const c of ((inbox && inbox.data && inbox.data.children) || [])) {
      const d = c.data; if (!d) continue;
      events.push({ platform: 'reddit', kind: 'mention', id: d.name, ts: d.created_utc ? d.created_utc * 1000 : now, author: 'u/' + (d.author || ''), text: d.body || d.subject || '', url: 'https://www.reddit.com' + (d.context || ''), uri: d.name || '' });
    }
  } catch (e) { /* inbox unavailable */ }
  let account = null;
  try {
    const me = await J(base + '/api/me.json');
    const d = me && me.data;
    if (d && d.name) {
      account = { platform: 'reddit', handle: 'u/' + d.name, display: d.name };
      events.push({ platform: 'reddit', kind: 'metrics', id: 'metrics', ts: now, metrics: { followers: d.total_karma || ((d.link_karma || 0) + (d.comment_karma || 0)), following: 0, posts: d.link_karma || 0 } });
    }
  } catch (e) { /* me unavailable */ }
  return { ok: true, events, account };
}
async function redditSendInPage(action) {
  const base = location.origin;
  // Both submit and comment need the modhash (Reddit's CSRF token).
  let modhash = '';
  try { const me = await fetch(base + '/api/me.json', { credentials: 'include' }).then((r) => r.json()); modhash = (me && me.data && me.data.modhash) || ''; } catch (e) { /* no modhash */ }
  if (!modhash) return { ok: false, error: 'could not get a modhash (log in; old.reddit.com is most reliable)' };
  try {
    if (action.op === 'post') {
      if (!action.target || !action.title) return { ok: false, error: 'Reddit post needs target (subreddit, without r/) + title' };
      const form = new URLSearchParams({ sr: String(action.target).replace(/^\/?r\//, ''), kind: 'self', title: String(action.title), text: String(action.text || ''), uh: modhash, api_type: 'json', resubmit: 'true' });
      const res = await fetch(base + '/api/submit', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() }).then((r) => r.json());
      const j = res && res.json;
      if (j && (!j.errors || !j.errors.length)) return { ok: true, url: (j.data && j.data.url) || '', uri: (j.data && j.data.name) || '' };
      return { ok: false, error: (j && j.errors && JSON.stringify(j.errors)) || 'submit failed' };
    }
    if (!action.reply_to) return { ok: false, error: 'Reddit reply needs the target thing-id (t1_/t3_) in reply_to' };
    const form = new URLSearchParams({ thing_id: String(action.reply_to), text: String(action.text || ''), uh: modhash, api_type: 'json' });
    const res = await fetch(base + '/api/comment', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() }).then((r) => r.json());
    const j = res && res.json;
    if (j && (!j.errors || !j.errors.length)) {
      const thing = j.data && j.data.things && j.data.things[0] && j.data.things[0].data;
      return { ok: true, uri: thing && thing.name, url: thing && thing.permalink ? 'https://www.reddit.com' + thing.permalink : '' };
    }
    return { ok: false, error: (j && j.errors && JSON.stringify(j.errors)) || 'comment failed' };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

// ---- X / Twitter (public web bearer + ct0 cookie; GraphQL) -----------------
// Auth is stable: the bearer is a public constant in the web app and the CSRF
// token is the ct0 cookie. The FRAGILE part is GraphQL — per-operation query IDs
// and the `features` object rotate. If a call fails, read the current id from the
// Network tab (x.com/i/api/graphql/<ID>/<Op>) and update X_QID / X_FEATURES.
const X_QID = { HomeTimeline: 'HJFjzBgCs16TqxewQOeLbg', CreateTweet: 'a1p9RWpkYKBjWv_I3WzS-A' };
const X_FEATURES = {};   // CreateTweet requires a populated feature-flag map; fill from a live request if posts 400.
function xAuth() {
  const ct0 = (document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/) || [])[1];
  if (!ct0) return null;
  return { ct0, bearer: 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs=1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA' };
}
function xHeaders(a, post) {
  return { authorization: 'Bearer ' + a.bearer, 'x-csrf-token': a.ct0, 'x-twitter-active-user': 'yes', 'x-twitter-auth-type': 'OAuth2Session', ...(post ? { 'content-type': 'application/json' } : {}) };
}
async function xScrapeInPage() {
  const a = xAuth();
  if (!a) return { ok: false, error: 'no X session (log in at x.com)' };
  const now = Date.now();
  const events = [];
  const api = 'https://x.com/i/api';
  try {
    const vars = encodeURIComponent(JSON.stringify({ count: 20, includePromotedContent: false, withCommunity: false }));
    const r = await fetch(api + '/graphql/' + X_QID.HomeTimeline + '/HomeTimeline?variables=' + vars + '&features=' + encodeURIComponent(JSON.stringify(X_FEATURES)), { headers: xHeaders(a), credentials: 'include' }).then((x) => x.json());
    const instr = (((r.data || {}).home || {}).home_timeline_urt || {}).instructions || [];
    for (const ins of instr) for (const e of (ins.entries || [])) {
      const res = ((((e.content || {}).itemContent || {}).tweet_results || {}).result) || null;
      const legacy = res && res.legacy;
      const user = res && res.core && res.core.user_results && res.core.user_results.result && res.core.user_results.result.legacy;
      if (!legacy) continue;
      events.push({ platform: 'x', kind: 'feed', id: legacy.id_str || e.entryId, ts: Date.parse(legacy.created_at) || now, author: '@' + ((user && user.screen_name) || ''), text: legacy.full_text || '', url: 'https://x.com/i/status/' + (legacy.id_str || ''), uri: legacy.id_str || '', counts: { likes: legacy.favorite_count || 0, reposts: legacy.retweet_count || 0, replies: legacy.reply_count || 0 } });
    }
  } catch (e) { /* timeline unavailable — HomeTimeline queryId likely stale */ }
  let account = null;
  try {
    const st = await fetch(api + '/1.1/account/settings.json', { headers: xHeaders(a), credentials: 'include' }).then((x) => x.json());
    if (st && st.screen_name) {
      account = { platform: 'x', handle: '@' + st.screen_name, display: st.screen_name };
      try {
        const u = await fetch(api + '/1.1/users/show.json?screen_name=' + encodeURIComponent(st.screen_name), { headers: xHeaders(a), credentials: 'include' }).then((x) => x.json());
        if (u && u.followers_count != null) events.push({ platform: 'x', kind: 'metrics', id: 'metrics', ts: now, metrics: { followers: u.followers_count, following: u.friends_count || 0, posts: u.statuses_count || 0 } });
      } catch (e) { /* users/show gated */ }
    }
  } catch (e) { /* settings unavailable */ }
  return { ok: true, events, account };
}
async function xSendInPage(action) {
  const a = xAuth();
  if (!a) return { ok: false, error: 'no X session' };
  const variables = { tweet_text: String(action.text || ''), dark_request: false, media: { media_entities: [], possibly_sensitive: false }, semantic_annotation_ids: [] };
  if (action.op === 'reply' && action.reply_to) variables.reply = { in_reply_to_tweet_id: String(action.reply_to).split('/').pop(), exclude_reply_user_ids: [] };
  try {
    const res = await fetch('https://x.com/i/api/graphql/' + X_QID.CreateTweet + '/CreateTweet', { method: 'POST', headers: xHeaders(a, true), credentials: 'include', body: JSON.stringify({ variables, features: X_FEATURES, queryId: X_QID.CreateTweet }) }).then((x) => x.json());
    const id = (((((res.data || {}).create_tweet || {}).tweet_results || {}).result) || {}).rest_id;
    if (id) return { ok: true, uri: id, url: 'https://x.com/i/status/' + id };
    return { ok: false, error: (res.errors && JSON.stringify(res.errors)) || 'CreateTweet failed — queryId/features may be stale (see X_QID/X_FEATURES)' };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

// ---- LinkedIn (Voyager API; JSESSIONID is the CSRF token) ------------------
// Auth is stable (csrf = JSESSIONID cookie). Voyager endpoints + request bodies
// are versioned and drift — treat reads/writes as best-effort.
function liCsrf() {
  const j = (document.cookie.match(/JSESSIONID="?([^";]+)"?/) || [])[1];
  return j || null;
}
function liHeaders(csrf, post) {
  return { 'csrf-token': csrf, accept: 'application/vnd.linkedin.normalized+json+2.1', 'x-restli-protocol-version': '2.0.0', ...(post ? { 'content-type': 'application/json; charset=UTF-8' } : {}) };
}
async function liScrapeInPage() {
  const csrf = liCsrf();
  if (!csrf) return { ok: false, error: 'no LinkedIn session (log in at linkedin.com)' };
  const base = 'https://www.linkedin.com/voyager/api';
  const now = Date.now();
  const events = [];
  let account = null;
  try {
    const me = await fetch(base + '/me', { headers: liHeaders(csrf), credentials: 'include' }).then((r) => r.json());
    const mp = (me.included && me.included.find((x) => x.firstName)) || (me.data && me.data.miniProfile) || null;
    if (mp) {
      const name = ((mp.firstName || '') + ' ' + (mp.lastName || '')).trim();
      if (name) account = { platform: 'linkedin', handle: mp.publicIdentifier ? ('in/' + mp.publicIdentifier) : name, display: name };
    }
  } catch (e) { /* me unavailable */ }
  try {
    const nt = await fetch(base + '/voyagerIdentityDashNotificationCards?count=20&q=notifications', { headers: liHeaders(csrf), credentials: 'include' }).then((r) => r.json());
    for (const el of (nt.included || [])) {
      const txt = (el.headline && el.headline.text) || (el.subHeadline && el.subHeadline.text);
      if (txt) events.push({ platform: 'linkedin', kind: 'notification', id: el.entityUrn || String(events.length), ts: now, author: '', text: txt, url: 'https://www.linkedin.com/notifications/', uri: el.entityUrn || '' });
    }
  } catch (e) { /* notifications shape varies */ }
  return { ok: true, events, account };
}
async function liSendInPage(action) {
  const csrf = liCsrf();
  if (!csrf) return { ok: false, error: 'no LinkedIn session' };
  if (action.op === 'reply') return { ok: false, error: 'LinkedIn replies (comments) not supported yet — post a share instead' };
  const body = { visibleToConnectionsOnly: false, externalAudienceProviders: [], commentaryV2: { text: String(action.text || ''), attributes: [] }, origin: 'FEED', allowedCommentersScope: 'ALL', postState: 'PUBLISHED', media: [] };
  try {
    const res = await fetch('https://www.linkedin.com/voyager/api/contentcreation/normShares', { method: 'POST', headers: liHeaders(csrf, true), credentials: 'include', body: JSON.stringify(body) });
    if (res.ok) { let j = {}; try { j = await res.json(); } catch (e) { /* empty body ok */ } const urn = (j.data && j.data.urn) || j.urn || ''; return { ok: true, uri: urn, url: urn ? ('https://www.linkedin.com/feed/update/' + urn) : 'https://www.linkedin.com/feed/' }; }
    return { ok: false, error: 'normShares HTTP ' + res.status + ' (endpoint/body may have changed)' };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

// ---- Instagram (private web API; x-ig-app-id + csrftoken) ------------------
// Read-only: IG has no text-only posts (every post needs media), so send() is a
// clear refusal. x-ig-app-id is the public web app id.
const IG_APP_ID = '936619743392459';
async function igScrapeInPage() {
  const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
  if (!csrf) return { ok: false, error: 'no Instagram session (log in at instagram.com)' };
  const H = { 'x-ig-app-id': IG_APP_ID, 'x-csrftoken': csrf, 'x-requested-with': 'XMLHttpRequest' };
  const base = 'https://www.instagram.com/api/v1';
  const now = Date.now();
  const events = [];
  let account = null;
  try {
    const cu = await fetch(base + '/accounts/current_user/', { headers: H, credentials: 'include' }).then((r) => r.json());
    const me = cu && cu.user;
    if (me && me.username) {
      const prof = await fetch(base + '/users/web_profile_info/?username=' + encodeURIComponent(me.username), { headers: H, credentials: 'include' }).then((r) => r.json());
      const u = prof && prof.data && prof.data.user;
      account = { platform: 'instagram', handle: '@' + me.username, display: (u && u.full_name) || me.username };
      if (u) events.push({ platform: 'instagram', kind: 'metrics', id: 'metrics', ts: now, metrics: { followers: (u.edge_followed_by && u.edge_followed_by.count) || 0, following: (u.edge_follow && u.edge_follow.count) || 0, posts: (u.edge_owner_to_timeline_media && u.edge_owner_to_timeline_media.count) || 0 } });
    }
  } catch (e) { /* profile unavailable */ }
  try {
    const news = await fetch(base + '/news/inbox/', { headers: H, credentials: 'include' }).then((r) => r.json());
    for (const s of [].concat(news.new_stories || [], news.old_stories || [])) {
      const t = s && s.args && s.args.text;
      if (t) events.push({ platform: 'instagram', kind: 'notification', id: (s.args && s.args.tuuid) || String(events.length), ts: s.args && s.args.timestamp ? s.args.timestamp * 1000 : now, author: '', text: t, url: 'https://www.instagram.com/', uri: '' });
    }
  } catch (e) { /* activity unavailable */ }
  return { ok: true, events, account };
}
async function igSendInPage() {
  return { ok: false, error: 'Instagram posts require media — text-only posting is not supported.' };
}

// ---- Threads (Meta text app; x-ig-app-id + fb_dtsg/lsd tokens) -------------
const THREADS_APP_ID = '238260118697367';
const THREADS_CREATE_DOC_ID = '';   // capture a "create text post" request and paste its doc_id here to enable posting
function metaTokens() {
  const html = document.documentElement.innerHTML;
  return {
    lsd: (html.match(/"LSD",\[\],\{"token":"([^"]+)"/) || [])[1] || (html.match(/name="lsd" value="([^"]+)"/) || [])[1] || '',
    dtsg: (html.match(/"DTSGInitialData",\[\],\{"token":"([^"]+)"/) || [])[1] || (html.match(/name="fb_dtsg" value="([^"]+)"/) || [])[1] || '',
  };
}
async function threadsScrapeInPage() {
  const csrf = (document.cookie.match(/csrftoken=([^;]+)/) || [])[1];
  if (!csrf) return { ok: false, error: 'no Threads session (log in at threads.net)' };
  const H = { 'x-ig-app-id': THREADS_APP_ID, 'x-csrftoken': csrf, 'x-requested-with': 'XMLHttpRequest' };
  const now = Date.now();
  const events = [];
  let account = null;
  try {
    const cu = await fetch('https://www.threads.net/api/v1/accounts/current_user/', { headers: H, credentials: 'include' }).then((r) => r.json());
    const me = cu && cu.user;
    if (me && me.username) {
      account = { platform: 'threads', handle: '@' + me.username, display: me.full_name || me.username };
      events.push({ platform: 'threads', kind: 'metrics', id: 'metrics', ts: now, metrics: { followers: me.follower_count || 0, following: 0, posts: me.media_count || 0 } });
    }
  } catch (e) { /* current_user unavailable */ }
  return { ok: true, events, account };
}
async function threadsSendInPage(action) {
  const { lsd, dtsg } = metaTokens();
  if (!lsd && !dtsg) return { ok: false, error: 'no Threads tokens in page (log in at threads.net)' };
  if (!THREADS_CREATE_DOC_ID) return { ok: false, error: 'Threads posting needs a doc_id — capture a create-post request and set THREADS_CREATE_DOC_ID' };
  try {
    const body = new URLSearchParams({ lsd: lsd, fb_dtsg: dtsg, doc_id: THREADS_CREATE_DOC_ID, variables: JSON.stringify({ text: String(action.text || '') }) });
    const res = await fetch('https://www.threads.net/api/graphql', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-fb-lsd': lsd, 'x-ig-app-id': THREADS_APP_ID }, credentials: 'include', body: body.toString() }).then((r) => r.json());
    if (res && res.data && !res.errors) return { ok: true, url: 'https://www.threads.net/' };
    return { ok: false, error: 'Threads post failed (doc_id/variables likely need live capture)' };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

// ---- Facebook (GraphQL; fb_dtsg + rotating doc_id) -------------------------
const FB_CREATE_DOC_ID = '';   // capture a ComposerStoryCreateMutation request and paste its doc_id here to enable posting
async function fbScrapeInPage() {
  const cuser = (document.cookie.match(/c_user=([^;]+)/) || [])[1];
  if (!cuser) return { ok: false, error: 'no Facebook session (log in at facebook.com)' };
  // Reading the FB feed needs rotating GraphQL doc_ids — report the account only.
  return { ok: true, events: [], account: { platform: 'facebook', handle: 'fb:' + cuser, display: '' } };
}
async function fbSendInPage(action) {
  const { dtsg } = metaTokens();
  if (!dtsg) return { ok: false, error: 'no fb_dtsg token (log in at facebook.com)' };
  if (!FB_CREATE_DOC_ID) return { ok: false, error: 'Facebook posting needs a doc_id — capture a ComposerStoryCreateMutation and set FB_CREATE_DOC_ID' };
  try {
    const body = new URLSearchParams({ fb_dtsg: dtsg, doc_id: FB_CREATE_DOC_ID, variables: JSON.stringify({ input: { message: { text: String(action.text || '') } } }) });
    const res = await fetch('https://www.facebook.com/api/graphql/', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, credentials: 'include', body: body.toString() }).then((r) => r.text());
    if (res && res.indexOf('"errors"') === -1) return { ok: true, url: 'https://www.facebook.com/' };
    return { ok: false, error: 'Facebook post failed (doc_id/variables need live capture)' };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

// ---- YouTube (InnerTube; SAPISIDHASH auth + ytcfg) -------------------------
// Reads notifications best-effort. Community posts/comments need a target +
// params token, so send() is a clear refusal for now.
async function ytScrapeInPage() {
  const sapisid = (document.cookie.match(/(?:^|;\s*)(?:SAPISID|__Secure-3PAPISID)=([^;]+)/) || [])[1];
  let cfg = null;
  try { cfg = { key: window.ytcfg.get('INNERTUBE_API_KEY'), ctx: window.ytcfg.get('INNERTUBE_CONTEXT') }; } catch (e) { /* no ytcfg */ }
  if (!sapisid || !cfg || !cfg.key) return { ok: false, error: 'no YouTube session/config (log in at youtube.com)' };
  const origin = 'https://www.youtube.com';
  const ts = Math.floor(Date.now() / 1000);
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(ts + ' ' + sapisid + ' ' + origin));
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const H = { authorization: 'SAPISIDHASH ' + ts + '_' + hash, 'content-type': 'application/json', 'x-origin': origin };
  const now = Date.now();
  const events = [];
  // Inline (self-contained) text + notification collectors — executeScript can't
  // reference outer helpers.
  const runText = (r) => !r ? '' : (r.simpleText || (r.runs ? r.runs.map((x) => x.text).join('') : ''));
  const collect = (obj, out) => {
    if (!obj || typeof obj !== 'object' || out.length >= 20) return;
    if (obj.notificationRenderer && obj.notificationRenderer.shortMessage) out.push(runText(obj.notificationRenderer.shortMessage));
    for (const k in obj) collect(obj[k], out);
  };
  try {
    const r = await fetch(origin + '/youtubei/v1/notification/get_notification_menu?key=' + cfg.key, { method: 'POST', headers: H, credentials: 'include', body: JSON.stringify({ context: cfg.ctx, notificationsMenuRequestType: 'NOTIFICATIONS_MENU_REQUEST_TYPE_INBOX' }) }).then((x) => x.json());
    const msgs = [];
    collect(r, msgs);
    for (const t of msgs) if (t) events.push({ platform: 'youtube', kind: 'notification', id: String(events.length), ts: now, author: '', text: t, url: 'https://www.youtube.com/', uri: '' });
  } catch (e) { /* notifications unavailable */ }
  return { ok: true, events, account: null };
}
async function ytSendInPage() {
  return { ok: false, error: 'YouTube posting (community posts/comments) needs a target + params token — not supported yet.' };
}

// ---- adapter registry ------------------------------------------------------
// match(url, cfg): cfg carries mastodonHost (Mastodon is federated — the user
// grants their instance in the popup, so its host is config, not hard-coded).
const SOCIAL_ADAPTERS = {
  bluesky: { match: (url) => /^https:\/\/bsky\.app\//.test(url || ''), scrape: bskyScrapeInPage, send: bskySendInPage },
  mastodon: { match: (url, cfg) => !!(cfg && cfg.mastodonHost) && (url || '').indexOf(cfg.mastodonHost) === 0, scrape: mastoScrapeInPage, send: mastoSendInPage },
  reddit: { match: (url) => /^https:\/\/(www\.|old\.|new\.|sh\.)?reddit\.com\//.test(url || ''), scrape: redditScrapeInPage, send: redditSendInPage },
  x: { match: (url) => /^https:\/\/(x|twitter)\.com\//.test(url || ''), scrape: xScrapeInPage, send: xSendInPage },
  linkedin: { match: (url) => /^https:\/\/([a-z]+\.)?linkedin\.com\//.test(url || ''), scrape: liScrapeInPage, send: liSendInPage },
  instagram: { match: (url) => /^https:\/\/(www\.)?instagram\.com\//.test(url || ''), scrape: igScrapeInPage, send: igSendInPage },
  threads: { match: (url) => /^https:\/\/(www\.)?threads\.(net|com)\//.test(url || ''), scrape: threadsScrapeInPage, send: threadsSendInPage },
  facebook: { match: (url) => /^https:\/\/(www\.|web\.|m\.)?facebook\.com\//.test(url || ''), scrape: fbScrapeInPage, send: fbSendInPage },
  youtube: { match: (url) => /^https:\/\/(www\.|m\.)?youtube\.com\//.test(url || ''), scrape: ytScrapeInPage, send: ytSendInPage },
};

async function firstTabFor(adapter, cfg) {
  const tabs = await chrome.tabs.query({});
  return tabs.find((t) => adapter.match(t.url, cfg)) || null;
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
    const tab = await firstTabFor(ad, cfg);
    if (!tab) continue;
    let out;
    try { out = await runInTab(tab.id, ad.scrape); } catch (e) { continue; }   // tab closed / injection blocked
    if (!out || !out.ok) continue;
    if (out.events && out.events.length) await socialSendToApp('/ingest/social', { v: 1, events: out.events }).catch(() => {});
    if (out.account) accounts.push(out.account);
  }
  if (accounts.length) await socialSendToApp('/social/accounts', { accounts }).catch(() => {});
}

// The fields that make up what gets published. The popup showed the human one
// copy; the app's outbox holds the authoritative one. They must match.
const SOCIAL_PAYLOAD_KEYS = ['platform', 'op', 'text', 'reply_to', 'target', 'title'];
function socialSamePayload(a, b) {
  return SOCIAL_PAYLOAD_KEYS.every((k) => (a[k] == null ? '' : String(a[k])) === (b[k] == null ? '' : String(b[k])));
}

// Before publishing, ask the app whether this exact post is still staged. A post
// that was skipped / canceled (popup, MCP hq_social_cancel), already sent, or
// changed since the popup rendered it is refused — and nothing is reported back,
// because nothing was attempted. If the app can't be reached we refuse too:
// "can't confirm" never means "send anyway".
async function socialConfirmStaged(shown) {
  let d;
  try { d = await socialGetFromApp('/social/outbox'); }
  catch (e) { return { ok: false, error: "app link off — can't confirm the post is still staged, not sent" }; }
  if (!d || d.ok === false) return { ok: false, error: 'the app refused the outbox read (' + ((d && d.error) || 'no answer') + ') — not sent' };
  const fresh = (Array.isArray(d.actions) ? d.actions : []).find((a) => a && a.id === shown.id);
  if (!fresh || fresh.status !== 'staged') return { ok: false, error: 'no longer staged (skipped, canceled or already sent) — not sent' };
  if (!socialSamePayload(fresh, shown)) return { ok: false, error: 'the post changed since it was shown — not sent; review it again' };
  return { ok: true, action: fresh };
}

// WRITE pass: only ever called for an action the human approved in the popup.
async function socialSend(shown) {
  if (!shown || !shown.id) return { ok: false, error: 'no action id' };
  const check = await socialConfirmStaged(shown);
  if (!check.ok) return check;
  const action = check.action;
  const ad = SOCIAL_ADAPTERS[action.platform];
  if (!ad) return { ok: false, error: 'no adapter for ' + action.platform };
  const cfg = await socialCfg();
  const tab = await firstTabFor(ad, cfg);
  if (!tab) return { ok: false, error: 'open a logged-in ' + action.platform + ' tab first' };
  let res;
  try { res = await runInTab(tab.id, ad.send, [action]); } catch (e) { res = { ok: false, error: String((e && e.message) || e) }; }
  res = res || { ok: false, error: 'no result from adapter' };
  await socialSendToApp('/social/outbox/result', { id: action.id, ok: !!res.ok, url: res.url, uri: res.uri, error: res.error }).catch(() => {});
  return res;
}
