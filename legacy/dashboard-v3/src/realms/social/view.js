// SOCIAL — the SOCIAL BINDING's in-app face. Renders the scraped cross-platform
// feed / mentions / metrics and the post outbox, read live from the bridge via
// ctx.hq.getSocial() (the extension is the writer; this realm only displays).
// Composing + SENDING stay in the extension popup where the human approval gate
// lives — this realm is read-only by design (it can't publish anything).
import { el, esc } from '../../ui/util.js';

const PLAT_LABEL = { bluesky: 'Bluesky', mastodon: 'Mastodon', reddit: 'Reddit', x: 'X', linkedin: 'LinkedIn', instagram: 'Instagram', threads: 'Threads', facebook: 'Facebook', youtube: 'YouTube' };
const PLAT_GLYPH = { bluesky: '🦋', mastodon: '🐘', reddit: '🤖', x: '✕', linkedin: 'in', instagram: '📸', threads: '@', facebook: 'f', youtube: '▶' };
const platLabel = (p) => PLAT_LABEL[p] || p;
const glyph = (p) => PLAT_GLYPH[p] || '◆';

let CTX = null, sec = null, timer = 0;
// UI state survives re-render + realm switch (module scope, like grimoire's).
let tab = 'feed', platFilter = 'all', SOC = null, loaded = false;

function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}

const events = () => (SOC && SOC.inbox && Array.isArray(SOC.inbox.events)) ? SOC.inbox.events : [];
const actions = () => (SOC && SOC.outbox && Array.isArray(SOC.outbox.actions)) ? SOC.outbox.actions : [];
const accounts = () => (SOC && SOC.accounts && Array.isArray(SOC.accounts.accounts)) ? SOC.accounts.accounts : [];

function latestMetrics() {
  const by = {};
  for (const e of events()) {
    if (e.kind !== 'metrics') continue;
    const cur = by[e.platform];
    if (!cur || (e.ts || 0) > (cur.ts || 0)) by[e.platform] = e;
  }
  return Object.values(by);
}

async function load() {
  if (!CTX || !CTX.hq || !CTX.hq.getSocial) { loaded = true; SOC = null; render(); return; }
  try { SOC = await CTX.hq.getSocial(); } catch (e) { SOC = null; }
  loaded = true;
  render();
}

function feedCard(e) {
  const c = el('div', 'so-card' + (e.url ? ' lnk' : ''));
  c.innerHTML = `
    <div class="so-top">
      <span class="so-plat">${esc(glyph(e.platform))} ${esc(platLabel(e.platform))}</span>
      <span class="so-auth">${esc(e.author || '')}</span>
      <span class="so-ago">${esc(timeAgo(e.ts))}</span>
    </div>
    <div class="so-text">${esc(e.text || '')}</div>
    ${e.counts ? `<div class="so-counts">♥ ${e.counts.likes || 0} · ↻ ${e.counts.reposts || 0} · 💬 ${e.counts.replies || 0}</div>` : ''}`;
  // Cards are display-only; the raw url is shown on hover, not opened (keeps the
  // renderer from spawning windows — no external-open IPC surface added here).
  if (e.url) c.title = e.url;
  return c;
}

function outboxRow(a) {
  const r = el('div', 'so-ob s-' + esc(a.status));
  r.innerHTML = `
    <div class="so-top">
      <span class="so-plat">${esc(glyph(a.platform))} ${esc(platLabel(a.platform))}</span>
      <span class="so-op">${esc(a.op)}${a.target ? ` · r/${esc(a.target)}` : ''}</span>
      <span class="so-status">${esc(a.status)}</span>
    </div>
    ${a.title ? `<div class="so-obtitle">${esc(a.title)}</div>` : ''}
    <div class="so-text">${esc(a.text || '')}</div>
    ${a.status === 'staged' ? '<div class="so-hint">Awaiting your Approve &amp; Send in the extension popup.</div>' : ''}
    ${a.error ? `<div class="so-oberr">${esc(a.error)}</div>` : ''}`;
  return r;
}

function render() {
  if (!sec) return;
  sec.innerHTML = '';
  const noBridge = !CTX.hq || !CTX.hq.getSocial;

  const head = el('h2', 'sec', 'SOCIAL');
  const acts = el('span', 'sec-acts');
  const refresh = el('button', 'sec-btn', 'REFRESH');
  refresh.onclick = (ev) => { ev.stopPropagation(); refresh.textContent = '…'; load(); };
  acts.appendChild(refresh);
  head.appendChild(acts);
  sec.appendChild(head);

  if (!loaded) { sec.appendChild(el('div', 'empty-note', 'Loading social…')); return; }

  const evs = events();
  if (noBridge || (!evs.length && !actions().length && !accounts().length)) {
    sec.appendChild(el('div', 'empty-note', 'No social data yet. Load the <b>WorkspaceHQ Bridge</b> extension (<code>browser-bridge/</code>), open your logged-in social tabs, and hit <b>Sync</b> in the popup — then REFRESH here. Claude reads/stages via the <code>hq_social_*</code> tools; sending is approved in the popup.'));
    return;
  }

  const accs = accounts();
  if (accs.length) {
    const shelf = el('div', 'so-accounts');
    for (const a of accs) shelf.appendChild(el('span', 'so-acct', `${esc(glyph(a.platform))} ${esc(a.handle || '')}`));
    sec.appendChild(shelf);
  }

  const mets = latestMetrics();
  if (mets.length) {
    const grid = el('div', 'so-metrics');
    for (const m of mets) {
      const t = el('div', 'so-tile');
      const mm = m.metrics || {};
      t.innerHTML = `<div class="so-tile-plat">${esc(glyph(m.platform))} ${esc(platLabel(m.platform))}</div>
        <div class="so-tile-num">${(mm.followers || 0).toLocaleString()}</div>
        <div class="so-tile-lbl">followers · ${(mm.posts || 0).toLocaleString()} posts</div>`;
      grid.appendChild(t);
    }
    sec.appendChild(grid);
  }

  const staged = actions().filter((a) => a.status === 'staged').length;
  const tabs = [['feed', 'Feed'], ['mentions', 'Mentions'], ['outbox', `Outbox${staged ? ` (${staged})` : ''}`]];
  const tb = el('div', 'so-tabs');
  tb.innerHTML = tabs.map(([k, l]) => `<button data-t="${k}" class="${tab === k ? 'active' : ''}">${esc(l)}</button>`).join('');
  sec.appendChild(tb);
  tb.querySelectorAll('button').forEach((b) => { b.onclick = () => { tab = b.dataset.t; render(); }; });

  if (tab !== 'outbox') {
    const present = [...new Set(evs.filter((e) => e.kind !== 'metrics').map((e) => e.platform))];
    if (present.length > 1) {
      const chips = el('div', 'so-chips');
      const mk = (k, l) => { const c = el('button', 'so-chip' + (platFilter === k ? ' active' : ''), esc(l)); c.onclick = () => { platFilter = platFilter === k ? 'all' : k; render(); }; return c; };
      chips.appendChild(mk('all', 'All'));
      for (const p of present) chips.appendChild(mk(p, platLabel(p)));
      sec.appendChild(chips);
    }
  }

  const list = el('div', 'so-list');
  if (tab === 'outbox') {
    const rows = actions().slice().sort((a, b) => Date.parse(b.staged_at || 0) - Date.parse(a.staged_at || 0));
    if (!rows.length) list.appendChild(el('div', 'empty-note', 'No staged or sent posts. Ask Claude to stage one (hq_social_post), then approve it in the extension popup.'));
    for (const a of rows) list.appendChild(outboxRow(a));
  } else {
    const wantMention = tab === 'mentions';
    let hits = evs.filter((e) => wantMention ? (e.kind === 'mention' || e.kind === 'notification') : e.kind === 'feed');
    if (platFilter !== 'all') hits = hits.filter((e) => e.platform === platFilter);
    hits.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    if (!hits.length) list.appendChild(el('div', 'empty-note', wantMention ? 'No mentions captured yet.' : 'No feed items captured yet — hit Sync in the extension popup.'));
    for (const e of hits.slice(0, 100)) list.appendChild(feedCard(e));
  }
  sec.appendChild(list);
}

export const view = {
  mount(root, ctx) {
    CTX = ctx;
    loaded = false;
    sec = el('section', 'social-realm');
    root.appendChild(sec);
    render();
    load();
    // The sidecars refresh on the extension's ~5-min scrape; poll modestly and
    // let the REFRESH button cover the impatient case.
    timer = setInterval(load, 60000);
  },
  unmount() {
    clearInterval(timer); timer = 0;
    CTX = null; sec = null;
  },
};
