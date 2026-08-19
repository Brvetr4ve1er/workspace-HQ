// SYSTEM · SOCIAL — the SOCIAL BINDING's in-app face. Content ported from v3
// realms/social/view.js: presence, the latest per-platform metrics tiles, and
// the feed / mentions / outbox lists, read live from the bridge sidecars via
// hq.getSocial().
//
// READ-ONLY BY DESIGN. Composing and SENDING stay in the extension popup where
// the human approval gate lives — this section cannot publish anything, and the
// staged-post rows say so rather than offering a send button that would have to
// refuse.
import { el, esc, fmt } from '../../ui/util.js';

const PLAT_LABEL = { bluesky: 'Bluesky', mastodon: 'Mastodon', reddit: 'Reddit', x: 'X', linkedin: 'LinkedIn', instagram: 'Instagram', threads: 'Threads', facebook: 'Facebook', youtube: 'YouTube' };
const PLAT_GLYPH = { bluesky: '🦋', mastodon: '🐘', reddit: '🤖', x: '✕', linkedin: 'in', instagram: '📸', threads: '@', facebook: 'f', youtube: '▶' };
const platLabel = (p) => PLAT_LABEL[p] || String(p ?? '—');
const glyph = (p) => PLAT_GLYPH[p] || '◆';

// A status only ever reaches the DOM as a class through this whitelist; the
// raw value is still SHOWN (escaped) so an unknown status is never hidden.
const STATUS_CLASS = new Set(['staged', 'sent', 'failed', 'cancelled', 'queued']);
const MAX_ROWS = 100;
const POLL_MS = 60000;

// Payload + UI state survive a tab switch and a surface re-mount, so coming
// back to SOCIAL does not flash "Loading…" over data already in hand.
let SOC = null;
let loaded = false;
let tab = 'feed';
let platFilter = 'all';

function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm';
  if (s < 86400) return Math.floor(s / 3600) + 'h';
  return Math.floor(s / 86400) + 'd';
}

const events = () => (SOC && SOC.inbox && Array.isArray(SOC.inbox.events)) ? SOC.inbox.events.filter(Boolean) : [];
const actions = () => (SOC && SOC.outbox && Array.isArray(SOC.outbox.actions)) ? SOC.outbox.actions.filter(Boolean) : [];
const accounts = () => (SOC && SOC.accounts && Array.isArray(SOC.accounts.accounts)) ? SOC.accounts.accounts.filter(Boolean) : [];

// newest metrics event per platform
function latestMetrics() {
  const by = {};
  for (const e of events()) {
    if (e.kind !== 'metrics') continue;
    const cur = by[e.platform];
    if (!cur || (e.ts || 0) > (cur.ts || 0)) by[e.platform] = e;
  }
  return Object.values(by);
}

export function createSocialSection(api) {
  // api: { hq, data, alive() }
  const root = el('div', 'sys-sec');
  let dead = false;
  let timer = 0;
  const usable = () => !dead && api.alive() && root.isConnected;
  const hasBridge = typeof api.hq?.getSocial === 'function';
  let loadErr = null;

  async function load() {
    if (!hasBridge) { loaded = true; SOC = null; render(); return; }
    try {
      const next = await api.hq.getSocial();
      if (!usable()) return;                    // torn down mid-flight
      SOC = next; loadErr = null;
    } catch (err) {
      console.warn('[system] getSocial failed', err);
      if (!usable()) return;
      loadErr = String(err?.message || err);
    }
    loaded = true;
    render();
  }

  function feedCard(e) {
    const c = el('div', 'so-card', `
      <div class="so-top">
        <span class="so-plat">${esc(glyph(e.platform))} ${esc(platLabel(e.platform))}</span>
        <span class="so-auth">${esc(e.author || '')}</span>
        <span class="meta so-ago">${esc(timeAgo(e.ts))}</span>
      </div>
      <div class="body so-text">${esc(e.text || '')}</div>
      ${e.counts ? `<div class="meta so-counts">♥ ${fmt(Number(e.counts.likes) || 0)} · ↻ ${fmt(Number(e.counts.reposts) || 0)} · 💬 ${fmt(Number(e.counts.replies) || 0)}</div>` : ''}`);
    // Display-only: the raw url is shown on hover, never opened. Opening it
    // would need an external-open IPC surface this section deliberately lacks.
    if (e.url) c.title = String(e.url);
    return c;
  }

  function outboxRow(a) {
    const st = String(a.status ?? '');
    const r = el('div', 'so-ob');
    r.dataset.status = STATUS_CLASS.has(st) ? st : 'other';
    r.innerHTML = `
      <div class="so-top">
        <span class="so-plat">${esc(glyph(a.platform))} ${esc(platLabel(a.platform))}</span>
        <span class="so-op">${esc(a.op || '')}${a.target ? ` · r/${esc(a.target)}` : ''}</span>
        <span class="chip so-status">${esc(st || 'unknown')}</span>
      </div>
      ${a.title ? `<div class="so-obtitle">${esc(a.title)}</div>` : ''}
      <div class="body so-text">${esc(a.text || '')}</div>
      ${st === 'staged' ? '<div class="meta so-hint">Awaiting your Approve &amp; Send in the extension popup.</div>' : ''}
      ${a.error ? `<div class="so-oberr">${esc(a.error)}</div>` : ''}`;
    return r;
  }

  function render() {
    if (dead) return;
    root.innerHTML = '';
    const panel = el('section', 'panel', `
      <div class="panel-head">
        <span class="panel-title">Social</span>
        <span class="panel-sub">presence · read-only</span>
        <span class="spacer"></span>
      </div>
      <div class="panel-body"></div>`);
    const body = panel.querySelector('.panel-body');

    const refresh = el('button', 'btn btn--sm', 'Refresh');
    if (!hasBridge) {
      refresh.disabled = true;
      refresh.title = 'Needs the live app — the social bridge (hq.getSocial) is unavailable in this preview.';
    } else {
      refresh.title = `Re-read the bridge sidecars now (they also refresh on their own every ${Math.round(POLL_MS / 1000)}s)`;
      refresh.onclick = () => { refresh.disabled = true; refresh.textContent = 'Reading…'; load(); };
    }
    panel.querySelector('.panel-head').appendChild(refresh);
    root.appendChild(panel);

    if (!loaded) { body.appendChild(el('div', 'empty', 'Reading the social sidecars…')); return; }

    const evs = events();
    if (!hasBridge || (!evs.length && !actions().length && !accounts().length)) {
      body.appendChild(el('div', 'empty',
        `No social data yet. Load the <b>WorkspaceHQ Bridge</b> extension (<code>browser-bridge/</code>), open your
         logged-in social tabs, and hit <b>Sync</b> in the popup — then Refresh here. Claude reads and stages through
         the <code>hq_social_*</code> tools; sending is approved in the popup.`));
      if (loadErr) body.appendChild(el('div', 'meta so-err', `Last read failed — ${esc(loadErr)}`));
      return;
    }
    if (loadErr) body.appendChild(el('div', 'meta so-err', `Last refresh failed — ${esc(loadErr)}. Showing the previous read.`));

    const accs = accounts();
    if (accs.length) {
      const shelf = el('div', 'so-accounts');
      for (const a of accs) shelf.appendChild(el('span', 'chip so-acct', `${esc(glyph(a.platform))} ${esc(a.handle || platLabel(a.platform))}`));
      body.appendChild(shelf);
    }

    const mets = latestMetrics();
    if (mets.length) {
      const grid = el('div', 'so-metrics');
      for (const m of mets) {
        const mm = m.metrics || {};
        grid.appendChild(el('div', 'so-tile', `
          <div class="eyebrow so-tile-plat">${esc(glyph(m.platform))} ${esc(platLabel(m.platform))}</div>
          <div class="figure">${fmt(Number(mm.followers) || 0)}</div>
          <div class="figure-label">followers · ${fmt(Number(mm.posts) || 0)} posts</div>
          ${m.ts ? `<div class="meta">read ${esc(timeAgo(m.ts))} ago</div>` : ''}`));
      }
      body.appendChild(grid);
    }

    const staged = actions().filter((a) => a.status === 'staged').length;
    const tabs = [['feed', 'Feed'], ['mentions', 'Mentions'], ['outbox', `Outbox${staged ? ` (${staged})` : ''}`]];
    const tb = el('div', 'so-tabs');
    for (const [k, l] of tabs) {
      const b = el('button', 'btn btn--sm' + (tab === k ? ' is-on' : ''), esc(l));
      b.onclick = () => { if (tab === k) return; tab = k; render(); };
      tb.appendChild(b);
    }
    body.appendChild(tb);

    if (tab !== 'outbox') {
      const present = [...new Set(evs.filter((e) => e.kind !== 'metrics').map((e) => e.platform))];
      if (present.length > 1) {
        const chips = el('div', 'so-chips');
        const mk = (k, l) => {
          const c = el('button', 'btn btn--sm' + (platFilter === k ? ' is-on' : ''), esc(l));
          c.onclick = () => { platFilter = platFilter === k ? 'all' : k; render(); };
          return c;
        };
        chips.appendChild(mk('all', 'All'));
        for (const p of present) chips.appendChild(mk(p, platLabel(p)));
        body.appendChild(chips);
      }
    }

    const list = el('div', 'so-list');
    if (tab === 'outbox') {
      const rows = actions().slice().sort((a, b) => Date.parse(b.staged_at || 0) - Date.parse(a.staged_at || 0));
      if (!rows.length) list.appendChild(el('div', 'empty', 'No staged or sent posts. Ask Claude to stage one (hq_social_post), then approve it in the extension popup.'));
      for (const a of rows.slice(0, MAX_ROWS)) list.appendChild(outboxRow(a));
      if (rows.length > MAX_ROWS) list.appendChild(el('div', 'meta', `Showing the ${MAX_ROWS} most recent of ${fmt(rows.length)}.`));
    } else {
      const wantMention = tab === 'mentions';
      let hits = evs.filter((e) => wantMention ? (e.kind === 'mention' || e.kind === 'notification') : e.kind === 'feed');
      if (platFilter !== 'all') hits = hits.filter((e) => e.platform === platFilter);
      hits.sort((a, b) => (b.ts || 0) - (a.ts || 0));
      if (!hits.length) list.appendChild(el('div', 'empty', wantMention ? 'No mentions captured yet.' : 'No feed items captured yet — hit Sync in the extension popup.'));
      for (const e of hits.slice(0, MAX_ROWS)) list.appendChild(feedCard(e));
      if (hits.length > MAX_ROWS) list.appendChild(el('div', 'meta', `Showing the ${MAX_ROWS} most recent of ${fmt(hits.length)}.`));
    }
    body.appendChild(list);
  }

  render();
  load();
  // The sidecars refresh on the extension's ~5-minute scrape; poll modestly and
  // let Refresh cover the impatient case. No bridge = no poll (a timer that can
  // only ever no-op is just a leak).
  if (hasBridge) timer = setInterval(load, POLL_MS);

  return {
    el: root,
    dispose() { dead = true; if (timer) { clearInterval(timer); timer = 0; } },
  };
}

// test/harness hook: forget the cached payload + UI state.
export function _resetSocial() { SOC = null; loaded = false; tab = 'feed'; platFilter = 'all'; }
