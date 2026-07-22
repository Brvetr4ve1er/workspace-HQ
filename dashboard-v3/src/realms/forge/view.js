// THE FORGE — Products split out of v2's overview (charter realm 2).
// Verbatim ports from dashboard/app.js: products grid + toolbar (renderOverview
// tail, ~892-919), projectCard + class sigils (~997-1053), WORKING ON NOW
// browser focus (~922-995), dev-status + browser-tab live wiring (~1786-1809).
// The project drawer itself is shared machinery in ui/components.js — cards
// only open it.
import { el, esc, COL } from '../../ui/util.js';
import { aos, aosRefresh, deltaSpan, deriveScanContext, devState, fmtDur, openDrawer } from '../../ui/components.js';

const $ = (id) => document.getElementById(id);

// filter state outlives re-renders and realm switches (v2 module-level lets)
let projFilter = 'all', projSearch = '';

function gitText(g) {
  if (!g.has_git) return 'no git';
  if (g.commits === 0) return '0 commits';
  if (!g.has_remote) return 'no remote';
  if (g.dirty > 20) return `${g.dirty} dirty`;
  if (g.dirty > 0) return `${g.dirty} dirty`;
  if (g.unpushed) return `${g.ahead} ahead`;
  return 'in sync';
}

// The Seven Classes (docs/CANON.md): deterministic auto-classify, first match wins.
// Display-gated by the theme lexicon (LX('classes')) so arcade stays pristine.
const CLASS_SIGIL = {
  guardian: '🛡️ Guardian', 'heavy-knight': '🏰 Heavy Knight', hunter: '⚔️ Hunter',
  wylder: '🌀 Wylder', recluse: '📜 Recluse', 'knight-of-ides': '🗝️ Knight of Ides', duchess: '👑 Duchess',
};
function classifyProject(p) {
  const s = p.signals || {}, ch = p.metrics.code_health, act = p.activity || {};
  if (s.has_ci && s.has_tests) return 'guardian';
  if ((ch.loc || 0) > 20000 || (ch.files || 0) > 400) return 'heavy-knight';
  if (act.state === 'active') return 'hunter';
  if (p.completion.pct < 40 && (act.days_since_commit ?? 99) < 30) return 'wylder';
  if (act.state === 'dormant' && s.has_readme) return 'recluse';
  if (/experiment|lab|poc|sandbox|test/i.test(p.name)) return 'knight-of-ides';
  return 'duchess';
}

function projectCard(p, prevP, ctx) {
  const g = p.metrics.git_safety, ch = p.metrics.code_health;
  const pc = p.completion.pct, barColor = pc < 50 ? COL.red : pc < 80 ? COL.orange : COL.green;
  const card = el('div', 'card');
  card.style.setProperty('--rc', g.risk === 'high' ? COL.red : g.risk === 'medium' ? COL.orange : COL.green);
  const dpc = prevP ? p.completion.pct - prevP.completion.pct : 0;

  const isRunning = devState[p.id];
  let devHtml = '';
  if (ctx.hq && p.dev_cmd) {
    // v2 baked an inline onclick attribute; v3's CSP (script-src 'self') blocks
    // those, so the same handler attaches below via the element property.
    devHtml = `<button class="cdevbtn ${isRunning ? 'running' : ''}" id="cdevbtn-${esc(p.id)}" title="${isRunning ? 'Stop Server' : 'Launch Server'}">${isRunning ? '■' : '▶'}</button>`;
  }

  card.innerHTML = `
    ${devHtml}
    <div class="xpd">${dpc ? deltaSpan(dpc) : ''}</div>
    <h3><span class="pct">${pc}%</span><span class="nm">${esc(p.name)}</span></h3>
    <div class="stack">${esc((p.stack || []).slice(0, 4).join(' · '))}</div>
    <div class="bar"><i style="width:${pc}%;background:${barColor}"></i></div>
    <div class="badges"></div>`;
  const dv = card.querySelector('.cdevbtn');
  if (dv) dv.onclick = (e) => { e.stopPropagation(); window.hq[isRunning ? 'devStop' : 'devStart'](p.id); };
  const badges = card.querySelector('.badges');
  const buildCls = ch.build === 'red' ? 'red' : ['green', 'runs'].includes(ch.build) ? 'green' : '';
  badges.appendChild(el('span', 'tag ' + buildCls, `build: ${esc(ch.build)}`));
  badges.appendChild(el('span', 'tag ' + (g.risk === 'high' ? 'red' : g.risk === 'medium' ? 'orange' : 'green'), `git: ${esc(gitText(g))}`));
  const ts = ch.tests; badges.appendChild(el('span', 'tag', `tests: ${ts?.passing ? ts.passing + '/' + (ts.count ?? '?') : ts?.present ? 'present' : 'none'}`));
  badges.appendChild(el('span', 'tag blue', esc(p.activity.state)));
  if (ctx.LX('classes')) badges.appendChild(el('span', 'tag class', CLASS_SIGIL[classifyProject(p)]));
  card.onclick = () => openDrawer(p, prevP, ctx.data);
  return card;
}

// --------------------------------------------------------- browser focus
// "Working On Now" — active-tab focus streamed by the WorkspaceHQ Bridge
// browser extension (data/browser-activity.json -> S.browser). The current
// line also updates in real time via the hq:browser-tab IPC ticker (Electron).
let liveBrowserTab = null;

function agoText(iso) {
  if (!iso) return '';
  const then = Date.parse(iso); if (!Number.isFinite(then)) return '';
  const m = Math.round((Date.now() - then) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60); if (h < 24) return h + 'h ago';
  return Math.round(h / 24) + 'd ago';
}
function bfNowHtml(cur) {
  if (!cur) return `<span class="bf-dot"></span><span class="bf-domain idle">— idle —</span>`;
  const proj = cur.project_name || cur.project_id || '';
  return `<span class="bf-dot ${cur.live ? 'live' : ''}"></span>
    <span class="bf-domain">${esc(cur.host || cur.domain || '')}</span>
    ${proj ? `<span class="bf-proj">${esc(proj)}</span>` : ''}
    ${cur.focus_ms ? `<span class="bf-dur">${fmtDur(cur.focus_ms)}</span>` : ''}
    ${cur.title ? `<div class="bf-title">${esc(cur.title)}</div>` : ''}`;
}
function renderBrowserFocus(ov, S, ctx) {
  const B = S.browser;
  const isLatest = ctx.data.isLatest;
  const now0 = (isLatest && liveBrowserTab) ? liveBrowserTab : (B && B.current);
  if ((!B || !B.captured) && !now0) {
    if (isLatest && ctx.hq) {   // one-time setup nudge, live app only
      const hint = el('div', 'bfocus setup');
      hint.innerHTML = `<div class="bf-head"><span class="bf-k">◉ ${ctx.LX('working_now')}</span></div>
        <div class="bf-setup">Load the <b>WorkspaceHQ&nbsp;Bridge</b> Chrome extension (<code>browser-bridge/</code>) to see what you're building, live.</div>`;
      ov.appendChild(hint);
    }
    return;
  }
  const card = el('div', 'bfocus');
  card.innerHTML = `<div class="bf-head"><span class="bf-k">◉ ${ctx.LX('working_now')}</span>
      <span class="bf-src">browser${B && B.updated ? ' · ' + agoText(B.updated) : ''}</span></div>
    <div class="bf-now">${bfNowHtml(now0)}</div>`;
  const doms = (B && B.by_domain) || [];
  if (doms.length) {
    const max = doms[0].focus_ms || 1;
    const bars = el('div', 'bf-bars');
    doms.slice(0, 6).forEach((d) => {
      const row = el('div', 'bf-bar');
      row.innerHTML = `<span class="bf-bd">${esc(d.domain)}</span>
        <span class="bf-btrack"><i style="width:${Math.max(4, Math.round((d.focus_ms / max) * 100))}%"></i></span>
        <span class="bf-bt">${fmtDur(d.focus_ms)}</span>`;
      bars.appendChild(row);
    });
    card.appendChild(bars);
  }
  const projs = (B && B.by_project) || [];
  if (projs.length) {
    const row = el('div', 'bf-projs');
    projs.slice(0, 5).forEach((p) => row.appendChild(el('span', 'bf-chip', `${esc(p.project_name)} · ${fmtDur(p.focus_ms)}`)));
    card.appendChild(row);
  }
  ov.appendChild(card);
}
function paintBrowserLive(root) {
  const node = root.querySelector('.bfocus .bf-now');
  if (node) node.innerHTML = bfNowHtml(liveBrowserTab);
}

function render(root, ctx) {
  root.innerHTML = '';
  const { S, prevProj } = deriveScanContext(ctx.data);

  renderBrowserFocus(root, S, ctx);

  // products
  root.appendChild(el('h2', 'sec', ctx.LX('products')));
  const tb = el('div', 'toolbar');
  tb.innerHTML = `<input id="psearch" placeholder="Filter products…" value="${esc(projSearch)}" />
    <div class="seg" id="pseg">
      <button data-f="all" class="${projFilter === 'all' ? 'active' : ''}">All</button>
      <button data-f="risk" class="${projFilter === 'risk' ? 'active' : ''}">At risk</button>
      <button data-f="active" class="${projFilter === 'active' ? 'active' : ''}">Active</button>
      <button data-f="cold" class="${projFilter === 'cold' ? 'active' : ''}">Cold cases</button>
    </div><span class="count" id="pcount"></span>`;
  root.appendChild(tb);
  const grid = el('div', 'grid'); root.appendChild(grid);

  const drawCards = (animate) => {
    grid.innerHTML = '';
    let list = [...S.projects].sort((x, y) => y.completion.pct - x.completion.pct);
    const q = projSearch.trim().toLowerCase();
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.stack || []).join(' ').toLowerCase().includes(q));
    if (projFilter === 'risk') list = list.filter((p) => p.metrics.git_safety.risk === 'high' || p.metrics.code_health.build === 'red' || p.metrics.risk_security.score === 'high');
    if (projFilter === 'active') list = list.filter((p) => p.activity.state === 'active');
    if (projFilter === 'cold') list = list.filter((p) => p.activity.state === 'dormant').sort((x, y) => (y.activity.days_since_commit ?? 0) - (x.activity.days_since_commit ?? 0));
    $('pcount').textContent = `${list.length} / ${S.projects.length}`;
    list.forEach((p, i) => { const c = projectCard(p, prevProj[p.id], ctx); if (animate) aos(c, 'fade-up', i, 45); grid.appendChild(c); });
    if (animate) aosRefresh();
  };
  drawCards(true);
  // no reveal on live search redraw — cards swap instantly, no flicker
  $('psearch').oninput = (e) => { projSearch = e.target.value; drawCards(false); };
  tb.querySelectorAll('#pseg button').forEach((b) => b.onclick = () => { projFilter = b.dataset.f; render(root, ctx); });
}

export const view = {
  _offs: [],
  mount(root, ctx) {
    render(root, ctx);
    this._offs = [ctx.bus.on('data:select', () => render(root, ctx))];

    // dev-server run state → shared devState + live repaint of the card button
    // and the drawer's dev toggle (v2 app.js 1786-1803; feature-detected)
    if (ctx.hq?.onDevStatus) this._offs.push(ctx.hq.onDevStatus((d) => {
      devState[d.id] = d.running;
      const cbtn = $('cdevbtn-' + d.id);
      if (cbtn) {
        cbtn.className = 'cdevbtn ' + (d.running ? 'running' : '');
        cbtn.title = d.running ? 'Stop Server' : 'Launch Server';
        cbtn.innerHTML = d.running ? '■' : '▶';
        cbtn.onclick = (e) => { e.stopPropagation(); window.hq[d.running ? 'devStop' : 'devStart'](d.id); };
      }
      const dbtn = $('dwr-devbtn-' + d.id);
      if (dbtn) {
        dbtn.className = 'ab-btn dwr-dev-btn ' + (d.running ? 'running' : '');
        dbtn.querySelector('b').textContent = d.running ? '■ STOP' : '▶ DEV';
        dbtn.onclick = () => window.hq[d.running ? 'devStop' : 'devStart'](d.id);
      }
    }));

    // Live browser focus ticker: seed the current tab on mount, then update the
    // "Working On Now" line on every bridge flush — no full scan required.
    if (ctx.hq?.getBrowserLive) ctx.hq.getBrowserLive().then((l) => { liveBrowserTab = l; paintBrowserLive(root); }).catch(() => {});
    if (ctx.hq?.onBrowserTab) this._offs.push(ctx.hq.onBrowserTab((l) => { liveBrowserTab = l; paintBrowserLive(root); }));
  },
  unmount() {
    this._offs.forEach((off) => { try { off(); } catch { /* disposer already dead */ } });
    this._offs = [];
  },
};
