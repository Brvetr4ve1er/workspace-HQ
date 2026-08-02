// PROJECTS realm — the products grid, split out of v2's overview.
// Ports from dashboard/app.js: products grid + toolbar, the project card, the
// WORKING ON NOW browser-focus card, and the dev-status + browser-tab live
// wiring. v3 additions: a sort control + unified filters, and each card expands
// inline into an .nx-detail panel (git / completion / activity / stack / tasks /
// browser dwell) without opening the full drawer — the drawer stays one click
// away via the card's Open button.
import { el, esc, COL } from '../../ui/util.js';
import { aos, aosKids, aosRefresh, deltaSpan, deriveScanContext, devState, fmtDur, openDrawer, sfx } from '../../ui/components.js';
import { agencyProposals } from '../../intel/agency.mjs';
import { dispatch } from '../../core/actions.mjs';

const $ = (id) => document.getElementById(id);

// filter/sort/expand state outlives re-renders and realm switches (v2 module lets)
let projFilter = 'all', projSearch = '', projSort = 'completion';
const expanded = new Set();   // project ids whose peek panel survives repaints

function gitText(g) {
  if (!g.has_git) return 'no git';
  if (g.commits === 0) return '0 commits';
  if (!g.has_remote) return 'no remote';
  if (g.dirty > 20) return `${g.dirty} dirty`;
  if (g.dirty > 0) return `${g.dirty} dirty`;
  if (g.unpushed) return `${g.ahead} ahead`;
  return 'in sync';
}

// Project archetype label: deterministic auto-classify, first match wins. Plain,
// descriptive labels — display-gated by the theme lexicon (LX('classes')), which
// the default professional theme leaves off.
const CLASS_LABEL = {
  guardian: 'Hardened', 'heavy-knight': 'Large', hunter: 'Active',
  wylder: 'Early stage', recluse: 'Dormant', 'knight-of-ides': 'Experiment', duchess: 'Standard',
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

// --------------------------------------------------------- sort / filter keys
const RISK_RANK = { high: 3, medium: 1, low: 0 };
// composite "how much this needs attention" — deterministic, no RNG.
function riskScore(p) {
  const g = p.metrics.git_safety, ch = p.metrics.code_health, rs = p.metrics.risk_security;
  let s = RISK_RANK[g.risk] ?? 0;
  if (ch.build === 'red') s += 2;
  s += RISK_RANK[rs.score] ?? 0;
  if ((g.dirty || 0) > 20) s += 1;
  return s;
}
const recentKey = (p) => p.activity.days_since_commit ?? Infinity;   // 0 = today, nulls last
const isAtRisk = (p) => p.metrics.git_safety.risk === 'high' || p.metrics.code_health.build === 'red' || p.metrics.risk_security.score === 'high';
function sortProjects(list) {
  if (projSort === 'risk') list.sort((a, b) => riskScore(b) - riskScore(a) || a.completion.pct - b.completion.pct);
  else if (projSort === 'recent') list.sort((a, b) => recentKey(a) - recentKey(b) || b.completion.pct - a.completion.pct);
  else list.sort((a, b) => b.completion.pct - a.completion.pct);
  return list;
}

// -------------------------------------------------- inline detail (.nx-detail)
const TIER_COL = { red: COL.red, orange: COL.orange, yellow: COL.yellow };
function openTasksFor(S, pid) {
  const rank = { red: 0, orange: 1, yellow: 2 };
  return (S.quests || [])
    .filter((q) => (q.status === 'open' || q.status === 'in_progress') && q.project_id === pid)
    .sort((a, b) => (rank[a.tier] ?? 3) - (rank[b.tier] ?? 3));
}
const dwellFor = (S, pid) => ((S.browser && S.browser.by_project) || []).find((x) => x.project_id === pid) || null;

// Inline detail — the drawer's headline facts, one click without the full overlay.
function buildPeek(p, prevP, ctx) {
  const S = ctx.data.selected;
  const g = p.metrics.git_safety, ch = p.metrics.code_health, rs = p.metrics.risk_security;
  const dpc = prevP ? p.completion.pct - prevP.completion.pct : 0;
  const riskCls = g.risk === 'high' ? 'red' : g.risk === 'medium' ? 'orange' : 'green';
  const dsc = p.activity.days_since_commit;
  const commitTxt = dsc == null ? '—' : dsc === 0 ? 'today' : dsc + 'd ago';
  const ts = ch.tests;
  const testsTxt = ts?.passing ? `${ts.passing}/${ts.count ?? '?'}` : ts?.present ? 'present' : 'none';

  const tile = (k, v, cls) => `<div class="pk-t${cls ? ' ' + cls : ''}"><span class="pk-k">${esc(k)}</span><span class="pk-v">${v}</span></div>`;
  const metrics = [
    tile('completion', `${p.completion.pct}%${dpc ? ' ' + deltaSpan(dpc) : ''}`),
    tile('git', esc(gitText(g)), riskCls),
    tile('activity', esc(p.activity.state)),
    tile('last commit', esc(commitTxt)),
    tile('files · loc', `${esc(String(ch.files ?? '—'))} · ${esc((ch.loc || 0).toLocaleString())}`),
    tile('tests', esc(testsTxt)),
    tile('todo/fixme', esc(String(ch.todo_fixme ?? 0))),
    tile('secrets', esc(String(rs.secrets_found ?? 0)), (rs.secrets_found > 0 ? 'red' : '')),
  ].join('');

  const gitBits = [];
  if (g.branch) gitBits.push(`<span class="pk-branch">${esc(g.branch)}</span>${g.remote ? ` <span class="pk-arrow">→</span> ${esc(g.remote)}` : ''}`);
  const gm = [];
  if (g.dirty) gm.push(`${g.dirty} dirty`);
  if (g.ahead) gm.push(`${g.ahead} ahead`);
  if (g.behind) gm.push(`${g.behind} behind`);
  if (g.commits != null) gm.push(`${g.commits} commits`);

  const stackChips = (p.stack || []).map((s) => `<span class="pk-chip">${esc(s)}</span>`).join('') || '<span class="pk-none">no stack detected</span>';

  const oq = openTasksFor(S, p.id);
  const taskHtml = oq.length
    ? oq.slice(0, 4).map((q) => `<div class="pk-q"><i style="background:${TIER_COL[q.tier] || COL.blue}"></i>${esc(q.title)}</div>`).join('')
    : '<span class="pk-none">no open tasks</span>';

  const dw = dwellFor(S, p.id);
  const dwellHtml = dw
    ? `<b>${esc(fmtDur(dw.focus_ms))}</b> · ${esc(String(dw.visits))} visit${dw.visits === 1 ? '' : 's'}${dw.domains && dw.domains.length ? ` · ${esc(dw.domains.join(', '))}` : ''}`
    : '<span class="pk-none">no browser time this scan</span>';

  const rfiles = ch.recent_files || [];
  const filesHtml = rfiles.map((f) => `<button class="pk-file" type="button" data-f="${esc(f)}" title="${esc(f)}">${esc(f.split('/').pop())}</button>`).join('');

  const panel = el('div', 'nx-detail');
  panel.innerHTML = `
    <div class="pk-metrics">${metrics}</div>
    <div class="pk-line pk-git"><span class="pk-lbl">git</span><span class="pk-val">${gitBits.join(' ')}${gm.length ? ` · ${esc(gm.join(' · '))}` : ''}</span></div>
    ${g.last_commit_subject ? `<div class="pk-line pk-msg"><span class="pk-lbl">last</span><span class="pk-val">"${esc(g.last_commit_subject)}"</span></div>` : ''}
    <div class="pk-line"><span class="pk-lbl">stack</span><span class="pk-val pk-chips">${stackChips}</span></div>
    <div class="pk-line"><span class="pk-lbl">tasks</span><span class="pk-val pk-quests">${taskHtml}</span></div>
    <div class="pk-line"><span class="pk-lbl">browser</span><span class="pk-val">${dwellHtml}</span></div>
    ${filesHtml ? `<div class="pk-line"><span class="pk-lbl">recent</span><span class="pk-val pk-files">${filesHtml}</span></div>` : ''}
    ${p.completion.basis ? `<div class="pk-basis">${esc(p.completion.basis)}</div>` : ''}`;

  // clicks inside the peek must not bubble to the card's collapse handler
  panel.addEventListener('click', (e) => e.stopPropagation());
  // recent-file open (live app only; feature-detected — never throws in the harness)
  if (ctx.hq && window.hq?.openFile) panel.querySelectorAll('.pk-file').forEach((b) => b.onclick = () => window.hq.openFile(p.path, b.getAttribute('data-f')));
  return panel;
}
function togglePeek(p, prevP, card, ctx) {
  const open = !expanded.has(p.id);
  if (open) expanded.add(p.id); else expanded.delete(p.id);
  card.classList.toggle('open', open);
  let panel = card.querySelector('.nx-detail');
  if (open) { if (!panel) card.appendChild(buildPeek(p, prevP, ctx)); }
  else if (panel) panel.remove();
  sfx('blip');
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
    <div class="badges"></div>
    <div class="peek-hint">
      <span class="ph-left"><span class="ph-chev">▸</span> Details</span>
      <button class="ph-drawer" type="button" title="Open the full project panel">Open ⤢</button>
    </div>`;
  const dv = card.querySelector('.cdevbtn');
  if (dv) dv.onclick = (e) => { e.stopPropagation(); window.hq[isRunning ? 'devStop' : 'devStart'](p.id); };
  const badges = card.querySelector('.badges');
  const buildCls = ch.build === 'red' ? 'red' : ['green', 'runs'].includes(ch.build) ? 'green' : '';
  badges.appendChild(el('span', 'tag ' + buildCls, `build: ${esc(ch.build)}`));
  badges.appendChild(el('span', 'tag ' + (g.risk === 'high' ? 'red' : g.risk === 'medium' ? 'orange' : 'green'), `git: ${esc(gitText(g))}`));
  const ts = ch.tests; badges.appendChild(el('span', 'tag', `tests: ${ts?.passing ? ts.passing + '/' + (ts.count ?? '?') : ts?.present ? 'present' : 'none'}`));
  badges.appendChild(el('span', 'tag blue', esc(p.activity.state)));
  if (ctx.LX('classes')) badges.appendChild(el('span', 'tag class', CLASS_LABEL[classifyProject(p)]));

  // whole card toggles the inline detail; the Open button jumps to the drawer.
  card.setAttribute('data-expand', '');
  card.onclick = () => togglePeek(p, prevP, card, ctx);
  const drw = card.querySelector('.ph-drawer');
  if (drw) drw.onclick = (e) => { e.stopPropagation(); openDrawer(p, prevP, ctx.data); };
  if (expanded.has(p.id)) { card.classList.add('open'); card.appendChild(buildPeek(p, prevP, ctx)); }
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

// --------------------------------------------------------- suggested actions
// A secondary strip surfacing agencyProposals() (real signal gaps: no tests /
// CI / README / license) as two REAL actions per row — no invented IPC, both
// already registered in core/actions.mjs. Copy is deliberately honest about
// what each button actually does (see the two side-effect notes below); this
// is a quiet, load-bearing strip, not a headline feature — it must not
// outshout the product grid above it (Epic D #5/#7).
const AGENCY_CAP = 8;

// `claude:dispatch` shells to `start` a NEW TERMINAL WINDOW running
// `claude "<prompt>"` cd'd into the project (dashboard/main.js hq:claude-quest).
// spawnSync('start', ...) returns almost immediately — nothing here waits on
// Claude finishing — so the only honest confirmation is "a terminal opened",
// never "done"/"fixed". The handler resolves `false` when the project path
// can't be resolved to a cwd; that is a real failure, not a refusal to show.
function sendClaudeButton(p) {
  const btn = el('button', 'fa-btn fa-send', 'Send Claude');
  if (!window.hq?.claudeQuest) {
    btn.disabled = true;
    btn.title = 'Needs the live app — Claude dispatch is unavailable in this preview';
    return btn;
  }
  btn.title = 'Opens a new terminal window running Claude in this project — does not run automatically';
  btn.onclick = async () => {
    btn.disabled = true;
    btn.title = '';
    try {
      const r = dispatch('claude:dispatch', { projectPath: p.projectPath, prompt: p.seedPrompt });
      if (!r.ok) throw new Error(r.error || 'dispatch failed');
      const ok = await Promise.resolve(r.result);
      if (ok === false) throw new Error("couldn't resolve the project path");
      btn.textContent = 'Opened ▸';
      btn.title = 'A terminal window opened running Claude in this project';
      // stays disabled: re-clicking would spawn a second terminal
    } catch (err) {
      console.warn('[forge] claude:dispatch failed', err);
      btn.disabled = false;
      btn.textContent = '✗ Not opened — retry';
      btn.title = `Not opened — ${String(err?.message || err)}. Click to retry.`;
    }
  };
  return btn;
}

// `capture:note` writes the note, then main's hq:capture-save handler runs a
// BLOCKING spawnSync (re-assemble) followed by win.reload() — the app freezes
// briefly and the whole dashboard hard-reloads. The note only becomes a real
// side-quest after the next scan. Handling mirrors Med-Bay's cleanup panel
// (realms/medbay/view.js anomalyRow) exactly: in-flight label set BEFORE the
// await, the resolved VALUE (not just settlement) decides success, and a
// visible failure state that re-enables — never a silent reset. There is
// deliberately no persistent success state: win.reload() usually tears this
// view down before 'Noted' would ever be seen.
function addIdeaButton(p) {
  const btn = el('button', 'fa-btn fa-idea', 'Add to ideas');
  if (!window.hq?.captureSave) {
    btn.disabled = true;
    btn.title = 'Needs the live app — capture is unavailable in this preview';
    return btn;
  }
  btn.title = 'Adds to your Ideas feed — appears after the next scan; the dashboard will refresh';
  btn.onclick = async () => {
    btn.disabled = true;
    btn.title = '';
    btn.textContent = 'Saving…';   // set BEFORE the await — see note above
    try {
      const r = dispatch('capture:note', { text: p.captureText });
      if (!r.ok) throw new Error(r.error || 'dispatch failed');
      const ok = await Promise.resolve(r.result);
      if (ok === false) throw new Error('capture refused');
      btn.textContent = 'Noted';   // usually preempted by main's win.reload()
    } catch (err) {
      console.warn('[forge] capture:note failed', err);
      btn.disabled = false;
      btn.title = `Not saved — ${String(err?.message || err)}. Click to retry.`;
      btn.textContent = '✗ Not saved — retry';
    }
  };
  return btn;
}

function actionRow(p) {
  const row = el('div', 'fa-row');
  row.innerHTML = `
    <div class="fa-info">
      <span class="fa-proj">${esc(p.projectName)}</span>
      <span class="fa-gap">${esc(p.label)}</span>
    </div>
    <div class="fa-btns"></div>`;
  const btns = row.querySelector('.fa-btns');
  btns.appendChild(sendClaudeButton(p));
  btns.appendChild(addIdeaButton(p));
  return row;
}

// Empty state is "render nothing" (no proposals -> no section at all), so this
// returns null rather than an empty wrapper — the caller checks before append.
function buildActionsStrip(S) {
  const proposals = agencyProposals(S);
  if (!proposals.length) return null;
  const wrap = el('div', 'forge-actions');
  wrap.appendChild(el('h2', 'sec', 'Suggested actions'));
  const list = el('div', 'fa-list');
  proposals.slice(0, AGENCY_CAP).forEach((p) => list.appendChild(actionRow(p)));
  wrap.appendChild(list);
  if (proposals.length > AGENCY_CAP) wrap.appendChild(el('div', 'fa-more', `+${proposals.length - AGENCY_CAP} more`));
  return wrap;
}

function render(root, ctx) {
  root.innerHTML = '';
  if (!ctx.data.selected) return;   // empty/first-run bundle (no scans yet): render nothing rather than crash in deriveScanContext
  const { S, prevProj } = deriveScanContext(ctx.data);

  renderBrowserFocus(root, S, ctx);

  // products
  root.appendChild(el('h2', 'sec', ctx.LX('products')));
  const tb = el('div', 'toolbar');
  tb.innerHTML = `<input id="psearch" placeholder="Filter ${esc(ctx.LX('products').toLowerCase())}…" value="${esc(projSearch)}" />
    <div class="seg" id="pseg">
      <button data-f="all" class="${projFilter === 'all' ? 'active' : ''}">All</button>
      <button data-f="risk" class="${projFilter === 'risk' ? 'active' : ''}">At risk</button>
      <button data-f="active" class="${projFilter === 'active' ? 'active' : ''}">Active</button>
      <button data-f="cold" class="${projFilter === 'cold' ? 'active' : ''}">Dormant</button>
    </div>
    <div class="seg sortseg" id="psort">
      <span class="seg-lbl">sort</span>
      <button data-s="completion" class="${projSort === 'completion' ? 'active' : ''}">Completion</button>
      <button data-s="risk" class="${projSort === 'risk' ? 'active' : ''}">Risk</button>
      <button data-s="recent" class="${projSort === 'recent' ? 'active' : ''}">Recent</button>
    </div><span class="count" id="pcount"></span>`;
  root.appendChild(tb);
  const grid = el('div', 'grid forge-grid'); root.appendChild(grid);

  const drawCards = (animate) => {
    grid.innerHTML = '';
    let list = [...S.projects];
    const q = projSearch.trim().toLowerCase();
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.stack || []).join(' ').toLowerCase().includes(q));
    if (projFilter === 'risk') list = list.filter(isAtRisk);
    if (projFilter === 'active') list = list.filter((p) => p.activity.state === 'active');
    if (projFilter === 'cold') list = list.filter((p) => p.activity.state === 'dormant');
    sortProjects(list);
    $('pcount').textContent = `${list.length} / ${S.projects.length}`;
    list.forEach((p, i) => { const c = projectCard(p, prevProj[p.id], ctx); if (animate) aos(c, 'fade-up', i, 45); grid.appendChild(c); });
    if (animate) aosRefresh();
  };
  drawCards(true);
  // no reveal on live search/sort redraw — cards swap instantly, no flicker
  $('psearch').oninput = (e) => { projSearch = e.target.value; drawCards(false); };
  tb.querySelectorAll('#pseg button').forEach((b) => b.onclick = () => { projFilter = b.dataset.f; render(root, ctx); });
  tb.querySelectorAll('#psort button').forEach((b) => b.onclick = () => {
    projSort = b.dataset.s;
    tb.querySelectorAll('#psort button').forEach((x) => x.classList.toggle('active', x === b));
    drawCards(false);
  });

  // secondary strip, below the grid — quiet by design, see buildActionsStrip()
  const strip = buildActionsStrip(S);
  if (strip) {
    root.appendChild(strip);
    aosKids(strip.querySelector('.fa-list'), 'fade-up', 40);
    aosRefresh();
  }
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
