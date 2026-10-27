// Instagram / Facebook data exports ("Download your information") into the Hub. Facebook comes as JSON, Instagram as
// HTML here; each importer refuses the other format with a clear message instead of half-parsing it.
// DMs → conversations ('instagram:<thread>' / 'facebook:<thread>'), the owner's messages role 'user', everyone else role
// 'other' with the sender's name in tool_name. Everything else on the allowlist → 'social' documents in chunks (one
// category per chunk, ≤ CHUNK records). Only text entries are read: media is never touched (central directory only).
// Never indexed, whatever the scope: logins/security, passwords, payments, ID verification, location, devices, uploaded
// contacts (SENSITIVE below). Profile fields are a whitelist. maskSecrets runs on every string before it is stored.
import crypto from 'node:crypto';
import { maskSecrets } from './redact.mjs';
import { cutText, TEXT_MAX } from './parse-code.mjs';
import { readZipIndex, readEntry, baseName } from './unzip.mjs';

export const SOCIAL = 'social';
export const CHUNK = 100;
export const ENTRY_MAX = 64 * 1024 * 1024;
const ANNOUNCE_EVERY = 25;
const tick = () => new Promise((r) => setImmediate(r));
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const clean = (s) => String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
const safe = (s) => maskSecrets(clean(String(s))).text;
const one = (s, n = 400) => cutText(safe(String(s == null ? '' : s)).replace(/\s+/g, ' ').trim(), n);
export const ORIGIN_LABEL = { instagram: 'Instagram', facebook: 'Facebook' };
export const PROJECT = { instagram: 'instagram:dms', facebook: 'facebook:messenger' };
const PROJECT_NAME = { instagram: 'Instagram DMs', facebook: 'Facebook Messenger' };

// ---------------------------------------------------------------- encoding
// Meta's JSON writes UTF-8 bytes as \u00XX escapes ("Ø§Ù" for Arabic). A string whose code points all fit in a byte and
// that decodes as valid UTF-8 is re-decoded; anything else (real Latin-1 text, already-correct text) is kept as is.
export function fixMojibake(s) {
  if (typeof s !== 'string' || !/[\u0080-ÿ]/.test(s) || /[^\u0000-ÿ]/.test(s)) return s;
  const out = Buffer.from(s, 'latin1').toString('utf8');
  return out.includes('�') ? s : out;
}
export const parseMetaJson = (buf) => JSON.parse(String(buf), (_k, v) => fixMojibake(v));

// ---------------------------------------------------------------- dates
export function msIso(ms) {
  const n = Number(ms);
  if (!(Number.isFinite(n) && n > 0)) return null;
  const d = new Date(n);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
const secIso = (s) => msIso(Number(s) * 1000);
const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
// Instagram HTML: "Jan 26, 2026 6:26 pm" in the exporter's local time (no zone given) → ISO, or null
export function igDate(s) {
  const m = /^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4}),? (\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?$/i.exec(String(s || '').trim());
  if (!m || !(m[1].toLowerCase() in MONTHS)) return null;
  let h = Number(m[4]);
  if (m[7]) { const pm = m[7].toLowerCase() === 'pm'; if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
  const d = new Date(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2]), h, Number(m[5]), Number(m[6] || 0));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
const day = (iso) => (iso ? iso.slice(0, 10) : '');

// ---------------------------------------------------------------- Instagram HTML
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export const decodeEntities = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (all, e) => {
  if (e[0] === '#') { const c = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)); try { return String.fromCodePoint(c); } catch { return all; } }
  return ENT[e.toLowerCase()] ?? all;
});
const VOID = new Set(['img', 'br', 'hr', 'meta', 'link', 'input', 'source', 'wbr']);
const MEDIA = { img: '[photo]', video: '[video]', audio: '[audio]' };

// The export's item blocks (div._a6-g) → [{title, date, rows:[[label, value]], body, links}]. A block with content of its
// own absorbs the blocks nested in it (a liked post + its "Owner" block are one item); a block with none (a page
// wrapper) passes its children up as separate items.
export function igBlocks(html) {
  const src = String(html || '');
  const mainAt = src.search(/<main\b/i);
  const text = mainAt >= 0 ? src.slice(mainAt) : src.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, '');
  const out = [];
  const stack = [];            // open elements: {tag, block, date, h2}
  const frames = [];           // open blocks
  let td = null, row = null;
  const frame = () => frames[frames.length - 1] || null;
  const inside = (k) => stack.some((e) => e[k]);
  const fresh = () => ({ title: '', date: '', rows: [], body: [], links: [], kids: [] });
  const own = (f) => !!(f.title || f.date || f.rows.length || f.body.some((b) => b.trim()));
  const flat = (f) => ({ title: f.title.trim(), date: f.date.trim(), rows: f.rows, body: f.body.map((b) => b.trim()).filter(Boolean).join('\n'), links: f.links });
  function close(f) {
    const parent = frame();
    let items;
    if (own(f)) {
      const base = flat(f);
      for (const k of f.kids) { base.rows.push(...k.rows); if (k.title) base.rows.push(['', k.title]); if (k.body) base.body += (base.body ? '\n' : '') + k.body; base.links.push(...k.links); }
      items = [base];
    } else items = f.kids;
    if (parent) parent.kids.push(...items); else out.push(...items);
  }
  const addText = (t) => {
    const f = frame(); if (!f) return;
    if (inside('h2')) { f.title += t; return; }
    if (inside('date')) { f.date += t; return; }
    if (td) { td.parts.push(t); return; }
    if (!f.body.length) f.body.push('');
    f.body[f.body.length - 1] += t;
  };
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(text))) {
    if (m[4] !== undefined) { const t = decodeEntities(m[4]); if (t.trim()) addText(t.replace(/\s+/g, ' ')); continue; }
    const closing = !!m[1], tag = m[2].toLowerCase(), attrs = m[3] || '';
    if (!closing) {
      const cls = (/\bclass="([^"]*)"/.exec(attrs) || [])[1] || '';
      if (tag in MEDIA) addText(' ' + MEDIA[tag] + ' ');
      if (tag === 'a') { const h = decodeEntities((/\bhref="([^"]*)"/.exec(attrs) || [])[1] || ''); const f = frame(); if (f && /^https?:\/\//i.test(h)) f.links.push(h); }
      if (VOID.has(tag) || /\/\s*$/.test(attrs)) continue;
      const block = tag === 'div' && /(^|\s)_a6-g(\s|$)/.test(cls);
      const el = { tag, block, date: /(^|\s)_a6-o(\s|$)/.test(cls), h2: tag === 'h2' };
      stack.push(el);
      if (block) frames.push(fresh());
      if (tag === 'tr') row = [];
      if (tag === 'td') td = { parts: [] };
      if (tag === 'br' || tag === 'div') { const f = frame(); if (f && !td) f.body.push(''); }
      continue;
    }
    let i = stack.length - 1;
    while (i >= 0 && stack[i].tag !== tag) i--;
    if (i < 0) continue;   // a stray close tag
    while (stack.length > i) {
      const el = stack.pop();
      if (el.tag === 'td' && td) { if (row) row.push(td.parts); td = null; }
      if (el.tag === 'tr' && row) {
        const f = frame();
        if (f) {
          const cells = row.map((p) => p.map((s) => s.trim()).filter(Boolean));
          if (cells.length >= 2) f.rows.push([cells[0].join(' '), cells.slice(1).map((c) => c.join(' ')).join(' ')]);
          else if (cells.length === 1 && cells[0].length) f.rows.push([cells[0][0], cells[0].slice(1).join(' ')]);
        }
        row = null;
      }
      if (el.block) close(frames.pop());
    }
  }
  while (frames.length) close(frames.pop());
  return out;
}
export const igTitle = (html) => one(decodeEntities((/<title>([\s\S]*?)<\/title>/i.exec(String(html)) || [])[1] || ''), 200);

// One Instagram thread page → messages, newest page order kept as given; the caller sorts.
export function parseIgThreadHtml(html, { owners = [] } = {}) {
  const me = new Set(owners.filter(Boolean).map((s) => s.toLowerCase()));
  const msgs = [];
  for (const b of igBlocks(html)) {
    const at = igDate(b.date);
    if (!b.title || !at) continue;   // the header block (participants) has no date
    let body = b.body;
    for (const [k, v] of b.rows) body += (body ? '\n' : '') + (k && v ? k + ': ' + v : k || v);
    const links = b.links.filter((l) => !body.includes(l));
    if (links.length) body += (body ? '\n' : '') + links.map((l) => '[link: ' + l + ']').join(' ');
    const text = cutText(safe(body).trim(), TEXT_MAX);
    if (!text) continue;
    const sender = one(b.title, 120);
    msgs.push({ sender, at, text, mine: me.has(sender.toLowerCase()) });
  }
  return msgs;
}

// ---------------------------------------------------------------- Facebook JSON
export function parseFbThread(raw, { owners = [] } = {}) {
  const me = new Set(owners.filter(Boolean).map((s) => s.toLowerCase()));
  const msgs = [];
  for (const m of Array.isArray(raw && raw.messages) ? raw.messages : []) {
    if (!m || typeof m !== 'object') continue;
    const at = msIso(m.timestamp_ms);
    if (!at) continue;
    const parts = [];
    if (typeof m.content === 'string' && m.content.trim()) parts.push(m.content);
    if (Array.isArray(m.photos) && m.photos.length) parts.push('[photo' + (m.photos.length > 1 ? ' ×' + m.photos.length : '') + ']');
    if (Array.isArray(m.videos) && m.videos.length) parts.push('[video]');
    if (Array.isArray(m.audio_files) && m.audio_files.length) parts.push('[voice message]');
    if (Array.isArray(m.files) && m.files.length) parts.push('[file]');
    if (m.sticker) parts.push('[sticker]');
    if (m.gifs) parts.push('[gif]');
    if (m.share && typeof m.share.link === 'string' && /^https?:\/\//.test(m.share.link)) parts.push('[link: ' + m.share.link + ']');
    const text = cutText(safe(parts.join('\n')).trim(), TEXT_MAX);
    if (!text) continue;
    const sender = one(m.sender_name || 'unknown', 120);
    msgs.push({ sender, at, text, mine: me.has(sender.toLowerCase()) });
  }
  return { title: one(raw && raw.title, 200) || null, messages: msgs };
}

// Facebook records: any JSON file is a list of records (top-level array, or the first array property). A record becomes
// one line: date · title · the useful string leaves (local media paths, ids and URIs into the export are dropped).
const SKIP_KEYS = new Set(['uri', 'fbid', 'thread_path', 'media', 'id', 'backup_uri', 'thumbnail', 'creation_timestamp', 'href', 'icon']);
function leaves(v, out, depth = 0) {
  if (out.length > 40 || depth > 6) return;
  if (typeof v === 'string') { const t = v.trim(); if (t && !/^(your_facebook_activity|your_instagram_activity|media)\//.test(t)) out.push(t); return; }
  if (Array.isArray(v)) { for (const x of v) leaves(x, out, depth + 1); return; }
  if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (!SKIP_KEYS.has(k) && !/^is_|_id$/.test(k)) leaves(x, out, depth + 1); }
}
export function fbRecords(raw) {
  let list = Array.isArray(raw) ? raw : null;
  if (!list && raw && typeof raw === 'object') {
    const arrays = Object.values(raw).filter(Array.isArray);
    list = Array.isArray(raw.label_values) || !arrays.length ? [raw] : arrays.sort((a, b) => b.length - a.length)[0];
  }
  const recs = [];
  for (const r of list || []) {
    const at = r && typeof r === 'object' ? secIso(r.timestamp ?? r.creation_timestamp ?? r.start_timestamp) : null;
    const parts = [];
    if (r && Array.isArray(r.label_values)) {   // Meta's label/value records (ad settings, Marketplace, profile details)
      for (const lv of r.label_values) {
        if (!lv || typeof lv !== 'object') continue;
        const vals = []; leaves(lv.value ?? lv.vec ?? lv.dict ?? lv.timestamp_value ?? null, vals);
        if (typeof lv.label === 'string' && vals.length && keepRow(lv.label, vals.join(' '))) parts.push(lv.label + ': ' + vals.join(', '));
        else if (typeof lv.label === 'string' && !vals.length && !ROW_DROP.test(lv.label)) parts.push(lv.label);
      }
      if (typeof r.title === 'string' && r.title.trim()) parts.unshift(r.title);
    } else leaves(r, parts);
    const uniq = [...new Set(parts)];
    if (!uniq.length) continue;
    recs.push({ at, line: one((at ? day(at) + ' · ' : '') + uniq.join(' · '), 1500), who: null });
  }
  return recs;
}

// ---------------------------------------------------------------- categories
// Matched against the full entry path, first match wins. Anything matching SENSITIVE is never read.
export const SENSITIVE = [
  /^security_and_login_information\//, /facebook_accounts_center\//, /password/i, /facebook_payments\//, /payment/i, /checkout/i,
  /id_verification/, /\/location\//, /locations_of_interest/, /profile_based_in/, /last_location|primary_location/, /device/i, /detected_hardware/,
  /contacts_uploaded|synced_contacts|connections\/contacts\//, /two-factor/, /login/i, /cookies/i, /apps_and_websites_off_of/, /your_activity_off_meta/,
  /autofill/, /friend_map/, /other_categories_used_to_reach_you/, /\/files\//, /information_you've_submitted_to_advertisers/,
];
const IG = [
  [/media\/(posts(_\d+)?|reels|archived_posts|stories|other_content)\.html$/, 'posts', 'your posts, reels and stories'],
  [/comments\/[^/]+\.html$/, 'comments', 'your comments'],
  [/likes\/liked_posts\.html$/, 'likes', 'posts you liked', 'tally'],
  [/likes\/liked_comments\.html$/, 'likes', 'comments you liked', 'tally'],
  [/saved\/[^/]+\.html$/, 'saved', 'saved posts and collections', 'tally'],
  [/story_interactions\/stories_viewed\.html$/, 'stories-viewed', 'stories you viewed', 'tally'],
  [/story_interactions\/[^/]+\.html$/, 'story-activity', 'story likes, polls and questions', 'tally'],
  [/threads\/threads_and_replies\.html$/, 'threads', 'your Threads posts'],
  [/threads\/[^/]+\.html$/, 'threads-activity', 'Threads activity'],
  [/followers_and_following\/(following|followers_\d+)\.html$/, 'connections', 'followers and following'],
  [/followers_and_following\/[^/]+\.html$/, 'connections', 'follow requests, blocks and suggestions'],
  [/ads_information\/instagram_ads_and_businesses\/[^/]+\.html$/, 'ads', 'ad preferences and advertisers'],
  [/ads_information\/ads_and_topics\/(ads_viewed|posts_you're_interested_or_not_interested_in|profiles_you're_not_interested_in)\.html$/, 'ads', 'ads and topics'],
  [/preferences\/your_topics\/.+\.html$/, 'interests', 'your topics'],
  [/subscriptions\/[^/]+\.html$/, 'interests', 'subscriptions'],
  [/logged_information\/(recent_searches|link_history)\/[^/]+\.html$/, 'searches', 'searches and links you opened'],
  [/personal_information\/personal_information\/personal_information\.html$/, 'profile', 'your profile', 'profile'],
];
const FB = [
  [/posts\/your_posts[^/]*\.json$/, 'posts', 'your posts and check-ins'],
  [/posts\/(album\/\d+|your_videos|your_uncategorized_photos|archive|shared_memories|edits_you_made_to_posts|places_you_have_been_tagged_in)\.json$/, 'posts', 'albums, videos and post history'],
  [/stories\/archived_stories\.json$/, 'posts', 'your stories'],
  [/comments_and_reactions\/comments\.json$/, 'comments', 'your comments'],
  [/comments_and_reactions\/likes_and_reactions[^/]*\.json$/, 'likes', 'likes and reactions', 'tally'],
  [/groups\/(group_posts_and_comments|your_comments_in_groups|your_contributions|your_pending_group_posts)\.json$/, 'groups', 'your group posts and comments'],
  [/groups\/your_group_membership_activity\.json$/, 'groups', 'groups you joined'],
  [/pages\/[^/]+\.json$/, 'interests', 'pages you like and follow'],
  [/saved_items_and_collections\/[^/]+\.json$/, 'saved', 'saved items'],
  [/events\/[^/]+\.json$/, 'events', 'events'],
  [/facebook_marketplace\/(your_marketplace_items|items_sold|your_marketplace_listing_history|your_search_history|recent_searches_on_marketplace)\.json$/, 'marketplace', 'Marketplace listings and searches'],
  [/connections\/friends\/your_friends\.json$/, 'connections', 'friends'],
  [/connections\/followers\/[^/]+\.json$/, 'connections', 'who you follow'],
  [/ads_information\/(ad_preferences|other_categories_used_to_reach_you|advertisers_using_your_activity_or_information)\.json$/, 'ads', 'ad preferences and advertisers'],
  [/other_logged_information\/ads_interests\.json$/, 'interests', 'ad interests'],
  [/preferences\/preferences\/your_preferred_categories\.json$/, 'interests', 'preferred categories'],
  [/logged_information\/search\/your_search_history\.json$/, 'searches', 'your searches'],
  [/interactions\/groups_and_events_you've_visited\.json$/, 'groups', 'groups and events you visited'],
  [/profile_information\/profile_information\.json$/, 'profile', 'your profile', 'profile'],
];
export function categorize(origin, name) {
  if (SENSITIVE.some((r) => r.test(name))) return { skip: 'sensitive' };
  for (const [re, kind, label, mode] of origin === 'instagram' ? IG : FB) if (re.test(name)) return { kind, label, mode: mode || 'records' };
  return { skip: 'other' };
}
export const isThread = (origin, name) => (origin === 'instagram'
  ? /messages\/(inbox|message_requests)\/[^/]+\/message_\d+\.html$/.test(name)
  : /messages\/(inbox|archived_threads|e2ee_cutover|filtered_threads|message_requests)\/[^/]+\/message_\d+\.json$/.test(name));
const threadKey = (name) => name.split('/').slice(-2, -1)[0];

// Instagram HTML items → records; tally mode credits the item's account (Username, then Owner/Name rows).
// Metadata rows that say nothing about the owner, or that locate a device / place, are dropped (never indexed).
export const ROW_DROP = /^(time|creation time|date)$|\b(device|latitude|longitude|location|ip address|file size|width|height|source type|draft|advertisement|update time|publish mode|camera|created from|audio muted|amount raised|paid partnership|published|ai generated|duration|url|id|email|phone|birthday|address|connection|wi-?fi|carrier|operating system|browser)\b/i;
const keepRow = (k, v) => v && !ROW_DROP.test(String(k).trim()) && !/^(\d+([.,]\d+)?|true|false|yes|no)$/i.test(String(v).trim());
function igRecords(html) {
  return igBlocks(html).map((b) => {
    const dated = b.rows.find(([, v]) => igDate(v));
    const at = igDate(b.date) || (dated ? igDate(dated[1]) : null);
    const rows = b.rows.filter(([k, v]) => keepRow(k, v) && !igDate(v)).map(([k, v]) => (k ? k + ': ' + v : v));
    const body = [b.title, ...rows, b.body].filter(Boolean).join(' · ') || b.links[0] || '';
    const who = (b.rows.find(([k]) => /^username$/i.test(k)) || b.rows.find(([k]) => /^(media owner|owner|name)$/i.test(k)) || [])[1] || b.title || null;
    return body ? { at, line: one((at ? day(at) + ' · ' : '') + body, 1500), who: who ? one(who, 80) : null } : null;
  }).filter(Boolean);
}

// Profile: a whitelist, never emails / phone / birthday / family / addresses.
const PROFILE_OK = /^(username|name|full_name|bio|website|pronouns|gender_option|category|current_city|hometown|education_experiences|work_experiences|intro_bio|about_me|websites|profile_uri|favorite_quotes|pages|blurb|nickname)$/i;
function profileLines(origin, parsed) {
  const lines = [];
  if (origin === 'instagram') {
    for (const b of parsed) for (const [k, v] of b.rows) if (v && PROFILE_OK.test(k.replace(/\s+/g, '_'))) lines.push(k + ': ' + one(v, 300));
    return lines;
  }
  const p = (parsed && parsed.profile_v2) || {};
  for (const [k, v] of Object.entries(p)) {
    if (!PROFILE_OK.test(k)) continue;
    const parts = []; leaves(v, parts);
    if (parts.length) lines.push(k.replace(/_/g, ' ') + ': ' + one([...new Set(parts)].join(' · '), 800));
  }
  return lines;
}

// ---------------------------------------------------------------- report + owner
export function newMetaReport(origin) {
  return { source: origin, format: origin === 'instagram' ? 'html' : 'json', owner: false,
    conversations: { seen: 0, imported: 0, unchanged: 0, forgotten: 0, skipped: 0 }, messages: { imported: 0, skipped: 0, empty: 0 },
    documents: { imported: 0, unchanged: 0, removed: 0, categories: [] }, skippedFiles: { sensitive: 0, other: 0 }, truncated: false };
}

export function detectMetaOrigin(names) {
  const has = (n) => names.includes(n);
  if (has('instagram_profile_information.html') || has('instagram_profile_information.json')) return 'instagram';
  if ((has('profile_information.json') || has('profile_information.html')) && (has('your_friends.json') || has('your_friends.html') || has('messenger_active_status_settings.json') || has('messenger_active_status_settings.html'))) return 'facebook';
  return null;
}

async function findOwners(origin, zipPath, entries) {
  if (origin === 'instagram') {
    const e = entries.find((x) => /personal_information\/personal_information\/personal_information\.html$/.test(x.name));
    if (!e) return [];
    const rows = igBlocks(String(await readEntry(zipPath, e, { maxBytes: ENTRY_MAX }))).flatMap((b) => b.rows);
    return rows.filter(([k]) => /^(name|username)$/i.test(k)).map(([, v]) => one(v, 120)).filter(Boolean);
  }
  const e = entries.find((x) => /profile_information\/profile_information\.json$/.test(x.name));
  if (!e) return [];
  const p = parseMetaJson(await readEntry(zipPath, e, { maxBytes: ENTRY_MAX }));
  const n = p && p.profile_v2 && p.profile_v2.name;
  const prev = Array.isArray(p && p.profile_v2 && p.profile_v2.previous_names) ? p.profile_v2.previous_names.map((x) => x && x.name) : [];
  return n ? [n.full_name, [n.first_name, n.last_name].filter(Boolean).join(' '), ...prev].filter((s) => typeof s === 'string').map((s) => one(s, 120)).filter(Boolean) : [];
}

// ---------------------------------------------------------------- store writes
export function ingestThread(store, origin, key, { title, messages }, report) {
  const id = origin + ':' + key;
  report.conversations.seen++;
  if (store.isTombstoned('conversation', id) || store.isTombstoned('project', PROJECT[origin])) { report.conversations.forgotten++; return 'forgotten'; }
  if (!messages.length) { report.conversations.skipped++; return 'empty'; }
  const sorted = [...messages].sort((a, b) => a.at.localeCompare(b.at));
  const lastAt = sorted[sorted.length - 1].at;
  const prev = store.getSync(origin, key);
  if (prev && prev.updated_at && prev.updated_at >= lastAt) { report.conversations.unchanged++; return 'unchanged'; }
  let prevId = null;
  const msgs = sorted.map((m, i) => {
    const mid = id + ':' + i;
    const row = { id: mid, nativeId: String(i), parentId: prevId, role: m.mine ? 'user' : 'other', at: m.at, text: m.text, toolName: m.mine ? null : m.sender, isSidechain: false };
    prevId = mid; return row;
  });
  let added = 0;
  store.tx(() => {
    store.upsertProject({ id: PROJECT[origin], source: origin, key: PROJECT[origin].split(':')[1], name: PROJECT_NAME[origin], path: null });
    store.resetConversation(id);
    store.ensureConversation({ id, source: origin, projectId: PROJECT[origin], nativeId: key, cwd: null, gitBranch: null, model: null });
    const others = [...new Set(sorted.filter((m) => !m.mine).map((m) => m.sender))];
    const t = title || others.slice(0, 3).join(', ');
    if (t) store.setTitle(id, t, 'web');
    added = store.addMessages(id, msgs);
    store.setSync(origin, key, lastAt);
  });
  report.conversations.imported++;
  report.messages.imported += added;
  return 'imported';
}

// records of one category → chunk documents 'social:<origin>:<kind>:<n>' (+ a 'top accounts' summary for tallies)
export function writeCategory(store, origin, kind, label, recs, { tally = false, keep, report }) {
  const put = (id, title, text, ms) => {
    keep.add(id);
    const r = store.upsertDocument({ id, source: SOCIAL, title, text: cutText(text, TEXT_MAX), mtimeMs: ms || null, size: text.length, meta: { origin, kind } });
    if (r === 'added' || r === 'updated') report.documents.imported++; else if (r === 'unchanged') report.documents.unchanged++;
  };
  const O = ORIGIN_LABEL[origin];
  const sorted = [...recs].sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  const ms = (r) => (r && r.at ? Date.parse(r.at) : null);
  if (tally) {
    const count = new Map();
    for (const r of sorted) if (r.who) count.set(r.who, (count.get(r.who) || 0) + 1);
    const top = [...count].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 200);
    if (top.length) put(`social:${origin}:${kind}:top`, `${O} · ${label} — most frequent accounts`,
      `${O} ${label}: ${sorted.length} items. Accounts that appear most:\n` + top.map(([w, n]) => `${w} (${n})`).join('\n'), ms(sorted[0]));
  }
  for (let i = 0; i * CHUNK < sorted.length; i++) {
    const part = sorted.slice(i * CHUNK, (i + 1) * CHUNK);
    const span = [day(part[part.length - 1].at), day(part[0].at)].filter(Boolean);
    const when = span.length ? ' (' + (span[0] === span[1] ? span[0] : span.join(' → ')) + ')' : '';
    put(`social:${origin}:${kind}:${sha1(label)}:${i}`, `${O} · ${label}${sorted.length > CHUNK ? ' ' + (i + 1) + '/' + Math.ceil(sorted.length / CHUNK) : ''}${when}`,
      part.map((r) => '- ' + r.line).join('\n'), ms(part[0]));
  }
}

// ---------------------------------------------------------------- importer
export async function importMetaFile(store, zipPath, { onProgress = () => {}, onImported = () => {}, expect = null } = {}) {
  const { entries } = await readZipIndex(zipPath);
  const files = entries.filter((e) => !e.name.endsWith('/'));
  const origin = detectMetaOrigin(files.map((e) => baseName(e.name).toLowerCase()));
  if (!origin) throw new Error('Not an Instagram or Facebook export (looked for its profile information file)');
  if (expect && expect !== origin) throw new Error('That is a ' + ORIGIN_LABEL[origin] + ' export, not ' + (expect === 'instagram' ? 'an ' : 'a ') + ORIGIN_LABEL[expect] + ' export');
  const ext = origin === 'instagram' ? '.html' : '.json';
  if (!files.some((e) => e.name.endsWith(ext) && isThread(origin, e.name)) && files.some((e) => e.name.endsWith(origin === 'instagram' ? '.json' : '.html') && /message_\d+\./.test(e.name))) {
    throw new Error(ORIGIN_LABEL[origin] + ' export is in ' + (ext === '.html' ? 'JSON' : 'HTML') + ' format — request it again as ' + ext.slice(1).toUpperCase());
  }
  const report = newMetaReport(origin);
  const owners = await findOwners(origin, zipPath, files);
  report.owner = owners.length > 0;
  const text = files.filter((e) => e.name.endsWith(ext));
  // threads: all message_N parts of one folder together
  const threads = new Map();
  const cats = new Map();
  for (const e of text) {
    if (isThread(origin, e.name)) { const k = threadKey(e.name); if (!threads.has(k)) threads.set(k, []); threads.get(k).push(e); continue; }
    const c = categorize(origin, e.name);
    if (c.skip) { report.skippedFiles[c.skip]++; continue; }
    const key = c.kind + '|' + c.label;
    if (!cats.has(key)) cats.set(key, { ...c, entries: [] });
    cats.get(key).entries.push(e);
  }
  const total = threads.size + cats.size;
  let done = 0, fresh = [];
  const announce = () => { if (fresh.length) { const ids = fresh; fresh = []; onImported(ids); } };
  try {
    for (const [key, parts] of threads) {
      let title = null; const messages = [];
      for (const e of parts) {
        const buf = await readEntry(zipPath, e, { maxBytes: ENTRY_MAX });
        if (origin === 'instagram') { const html = String(buf); title = title || igTitle(html) || null; messages.push(...parseIgThreadHtml(html, { owners })); }
        else { const t = parseFbThread(parseMetaJson(buf), { owners }); title = title || t.title; messages.push(...t.messages); }
      }
      if (ingestThread(store, origin, key, { title, messages }, report) === 'imported') fresh.push(origin + ':' + key);
      onProgress({ phase: 'conversations', done: ++done, total });
      if (done % ANNOUNCE_EVERY === 0) { announce(); await tick(); }
    }
    announce();
    const keep = new Set();
    for (const c of cats.values()) {
      const recs = [];
      let profile = [];
      for (const e of c.entries) {
        const buf = await readEntry(zipPath, e, { maxBytes: ENTRY_MAX });
        if (origin === 'instagram') {
          const html = String(buf);
          if (c.mode === 'profile') profile.push(...profileLines(origin, igBlocks(html))); else recs.push(...igRecords(html));
        } else {
          const raw = parseMetaJson(buf);
          if (c.mode === 'profile') profile.push(...profileLines(origin, raw)); else recs.push(...fbRecords(raw));
        }
        await tick();
      }
      if (c.mode === 'profile') { if (profile.length) writeCategory(store, origin, c.kind, c.label, [{ at: null, line: profile.join('\n'), who: null }], { keep, report }); }
      else if (recs.length) writeCategory(store, origin, c.kind, c.label, recs, { tally: c.mode === 'tally', keep, report });
      if (recs.length || profile.length) report.documents.categories.push(c.label);
      onProgress({ phase: 'documents', done: ++done, total });
    }
    // a category that shrank or vanished since the last import of this origin leaves no stale chunks behind
    for (const id of store.documentStamps(SOCIAL).keys()) if (id.startsWith('social:' + origin + ':') && !keep.has(id) && store.removeDocument(id)) report.documents.removed++;
  } finally { announce(); }
  return report;
}
