// HISTORY — v2's STATS tab, enriched: personal-records callout, trend charts with
// hover tooltips (value + date at the snapped point), a consistency card,
// forecast + follow-through cards (folded from the retired ATLAS realm per the
// 2026-09-15 dead-weight audit), and clickable trophy cards that unfold their
// unlock criteria / progress.
// Render order: records → charts → progress cards → consistency → milestones grid.
import { el, esc, COL, fmt, DAY_MS } from '../../ui/util.js';
import { lineChart, stackedBar, legend, chartCard, aosKids, aosRefresh, deriveScanContext, sfx, ACH, PX } from '../../ui/components.js';
import { momentum } from '../../intel/derive.mjs';
import { forecastLine } from '../../intel/foresight.mjs';

// numeric gate for atlas-fold cards: fmt() passes non-numbers through as raw
// strings, so anything from scan data funnels through num() first.
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : 0);
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
const day = (iso) => String(iso || '').slice(0, 10);

// Empty state that keeps the grid even — a chart card with an empty-note body.
function emptyChartCard(title, msg) {
  return chartCard(title, null, `<div class="empty-note">${esc(msg)}</div>`);
}

// Consistency levels: a cosmetic streak signal, off the XP ledger. Derived at
// render — one "active day" per calendar day with ≥1 completed task across all
// recorded scans. Each threshold below unlocks the next level.
const CONSISTENCY_THRESHOLDS = [1, 3, 5, 8, 12, 17, 23, 30];

// Chart geometry — MUST mirror ui/components.js lineChart/stackedBar so the
// tooltip snaps to the same pixels the SVG was drawn with.
const CW = 320, CH = 130, CPAD = 26;

// Trophy expand state: keyed by achievement id (module scope), so an unfolded
// trophy stays open across data:select re-renders.
const openAch = new Set();

// ---------------------------------------------------------- personal records
// All derived from the SELECTED scan's trend arrays (filtered p.d <= cd) so the
// time-machine scrubber time-travels the records too. Deterministic.
const peak = (pts) => { let b = null; for (const p of pts) if (b === null || p.v > b.v) b = p; return b; };
const longestDailyRun = (pts) => {
  if (!pts.length) return null;
  const day = (d) => Math.floor(Date.parse(d + 'T00:00:00Z') / DAY_MS);
  let best = 1, cur = 1, endI = 0;
  for (let i = 1; i < pts.length; i++) {
    if (day(pts[i].d) - day(pts[i - 1].d) === 1) { cur++; if (cur > best) { best = cur; endI = i; } } else cur = 1;
  }
  return { len: best, end: pts[endI].d };
};

function renderRecords(parent, S) {
  const tr = S.trends || {}, cd = S.scan.id;
  const f = (arr) => (arr || []).filter((p) => p.d <= cd);
  const nameOf = {}; (S.projects || []).forEach((p) => (nameOf[p.id] = p.name));
  const recs = [];

  const h = peak(f(tr.health_index));
  if (h) recs.push({ c: COL.green, ic: '❤', k: 'Peak health', v: fmt(h.v), sub: h.d });
  const x = peak(f(tr.xp));
  if (x) recs.push({ c: COL.purple, ic: '✦', k: 'Peak account XP', v: fmt(x.v), sub: x.d });

  // Longest streak: canonical account field when present, else derive the
  // longest consecutive-scan-day run from the health series.
  const stk = S.account?.streak;
  let len = stk && Number.isFinite(stk.longest_scan_days) ? stk.longest_scan_days : null;
  let stkSub = 'consecutive scan-days';
  if (len == null) { const r = longestDailyRun(f(tr.health_index)); if (r) { len = r.len; stkSub = `through ${r.end}`; } }
  if (len != null) recs.push({ c: COL.gold, ic: '🔥', k: 'Longest streak', v: fmt(len), sub: stkSub });

  const cpk = peak(f(tr.casts_per_day));
  if (cpk && cpk.v > 0) recs.push({ c: COL.orange, ic: '⚡', k: 'Most runs / day', v: fmt(cpk.v), sub: cpk.d });

  let bc = null; const cbp = tr.completion_by_project || {};
  for (const id of Object.keys(cbp)) for (const p of f(cbp[id])) if (bc === null || p.v > bc.v) bc = { v: p.v, id, d: p.d };
  if (bc) recs.push({ c: COL.blue, ic: '◆', k: 'Best completion', v: bc.v + '%', sub: `${nameOf[bc.id] || bc.id} · ${bc.d}` });

  if (!recs.length) return;
  parent.appendChild(el('h2', 'sec', 'Personal records'));
  const grid = el('div', 'pr-callout');
  recs.forEach((r) => {
    const item = el('div', 'pr-item');
    item.style.setProperty('--pc', r.c);
    item.innerHTML = `
      <span class="pr-ic">${r.ic}</span>
      <span class="pr-v">${esc(r.v)}</span>
      <span class="pr-k">${esc(r.k)}</span>
      <span class="pr-sub">${esc(r.sub)}</span>`;
    grid.appendChild(item);
  });
  parent.appendChild(grid);
  aosKids(grid, 'zoom-in', 45);
}

// ------------------------------------------------------------- chart tooltips
// The tip/guide/dot trio lives INSIDE the chart element, so it dies with the
// realm-root rebuild — its mousemove/mouseleave listeners need no disposer.
function chartTip(chartEl) {
  const guide = el('div', 'nx-chart-guide'), dot = el('div', 'nx-chart-dot'), tip = el('div', 'nx-chart-tip');
  chartEl.append(guide, dot, tip);
  const hide = () => { chartEl.classList.remove('tip-on'); dot.style.display = 'none'; };
  return { guide, dot, tip, hide };
}

function attachLineTip(chartEl, series, cd) {
  const svg = chartEl.querySelector('svg'); if (!svg) return;
  const sl = series.map((s) => ({ color: s.color, label: s.label, pts: (s.points || []).filter((p) => p.d <= cd) }));
  const all = sl.flatMap((s) => s.pts.map((p) => p.v)); if (!all.length) return;
  const n = Math.max(...sl.map((s) => s.pts.length), 2);
  const max = Math.max(1, ...all), min = Math.min(...all, 0), range = (max - min) || 1;
  const sx = (i) => CPAD + (i * (CW - CPAD * 2)) / (n - 1);
  const sy = (v) => CH - CPAD - ((v - min) / range) * (CH - CPAD * 2);
  const ref = sl.reduce((a, b) => (b.pts.length > a.pts.length ? b : a), sl[0]);
  const t = chartTip(chartEl); let lastI = -1;
  const move = (e) => {
    const r = svg.getBoundingClientRect(), cr = chartEl.getBoundingClientRect(); if (!r.width) return;
    let i = Math.round(((e.clientX - r.left) / r.width * CW - CPAD) / ((CW - CPAD * 2) / (n - 1)));
    i = Math.max(0, Math.min(n - 1, i));
    const rows = sl.filter((s) => s.pts[i]).map((s) => ({ c: s.color, l: s.label, v: s.pts[i].v, d: s.pts[i].d }));
    if (!rows.length) { lastI = -1; t.hide(); return; }
    chartEl.classList.add('tip-on');
    const gx = r.left - cr.left + (sx(i) / CW) * r.width;
    t.guide.style.cssText = `left:${gx}px;top:${r.top - cr.top}px;height:${r.height}px`;
    const rp = ref.pts[i];
    if (rp) { t.dot.style.display = 'block'; t.dot.style.left = gx + 'px'; t.dot.style.top = (r.top - cr.top + (sy(rp.v) / CH) * r.height) + 'px'; t.dot.style.background = ref.color; t.dot.style.boxShadow = '0 0 8px ' + ref.color; }
    else t.dot.style.display = 'none';
    if (i !== lastI) {
      lastI = i;
      const body = rows.map((row) => `<span class="tp-row"><i style="background:${row.c}"></i>${row.l ? esc(row.l) + ' ' : ''}<b>${esc(fmt(row.v))}</b></span>`).join('');
      t.tip.innerHTML = `<span class="tp-d">${esc(rows[0].d)}</span>${body}`;
    }
    const half = t.tip.offsetWidth / 2, cw = cr.width;
    t.tip.style.left = Math.max(half + 4, Math.min(cw - half - 4, gx)) + 'px';
    t.tip.style.top = (r.top - cr.top + 4) + 'px';
  };
  svg.addEventListener('mousemove', move);
  svg.addEventListener('mouseleave', () => { lastI = -1; t.hide(); });
}

function attachBarTip(chartEl, rows0, keys, colors, cd, labels = {}) {
  const svg = chartEl.querySelector('svg'); if (!svg) return;
  const rows = rows0.filter((r) => r.d <= cd); if (!rows.length) return;
  const slot = (CW - CPAD * 2) / rows.length;
  const t = chartTip(chartEl); let lastI = -1;
  const move = (e) => {
    const r = svg.getBoundingClientRect(), cr = chartEl.getBoundingClientRect(); if (!r.width) return;
    let i = Math.floor(((e.clientX - r.left) / r.width * CW - CPAD) / slot);
    i = Math.max(0, Math.min(rows.length - 1, i));
    const row = rows[i]; chartEl.classList.add('tip-on'); t.dot.style.display = 'none';
    const gx = r.left - cr.left + ((CPAD + i * slot + slot / 2) / CW) * r.width;
    t.guide.style.cssText = `left:${gx}px;top:${r.top - cr.top}px;height:${r.height}px`;
    if (i !== lastI) {
      lastI = i;
      const total = keys.reduce((s, k) => s + (row[k] || 0), 0);
      const body = keys.map((k) => `<span class="tp-row"><i style="background:${colors[k]}"></i>${esc(labels[k] || k)} <b>${esc(fmt(row[k] || 0))}</b></span>`).join('');
      t.tip.innerHTML = `<span class="tp-d">${esc(row.d)} · ${esc(fmt(total))} total</span>${body}`;
    }
    const half = t.tip.offsetWidth / 2, cw = cr.width;
    t.tip.style.left = Math.max(half + 4, Math.min(cw - half - 4, gx)) + 'px';
    t.tip.style.top = (r.top - cr.top + 4) + 'px';
  };
  svg.addEventListener('mousemove', move);
  svg.addEventListener('mouseleave', () => { lastI = -1; t.hide(); });
}

// ------------------------------------------------------------------- charts
function renderTrends(tc, S) {
  renderRecords(tc, S);
  const tr = S.trends || {}; const cd = S.scan.id;
  const charts = el('div', 'charts'); tc.appendChild(charts);
  const last = (arr) => { const g = (arr || []).filter((p) => p.d <= cd); return g.length ? g[g.length - 1].v : null; };

  if (tr.health_index) {
    const s = [{ color: COL.green, area: true, points: tr.health_index, label: '' }];
    const cc = chartCard('Health index', last(tr.health_index), lineChart(s, cd));
    charts.appendChild(cc); attachLineTip(cc, s, cd);
  }
  if (tr.xp) {
    const s = [{ color: COL.purple, area: true, points: tr.xp, label: '' }];
    const cc = chartCard('Account XP', last(tr.xp), lineChart(s, cd));
    charts.appendChild(cc); attachLineTip(cc, s, cd);
  }
  if (tr.casts_per_day && tr.casts_per_day.length) {
    const s = [{ color: COL.gold, area: true, points: tr.casts_per_day, label: '' }];
    const cc = chartCard('Automation runs / day', last(tr.casts_per_day), lineChart(s, cd));
    charts.appendChild(cc); attachLineTip(cc, s, cd);
  }
  if (tr.completion_by_project) {
    const palette = [COL.blue, COL.purple, COL.green, COL.orange, COL.red, COL.cyan, COL.pink, '#a5d6ff', '#ffa657'];
    const ids = Object.keys(tr.completion_by_project);
    const nameOf = {}; S.projects.forEach((p) => (nameOf[p.id] = p.name));
    const series = ids.map((id, i) => ({ color: palette[i % palette.length], points: tr.completion_by_project[id], label: nameOf[id] || id }));
    const cc = chartCard('Completion % by project', null, lineChart(series, cd));
    cc.insertAdjacentHTML('beforeend', legend(ids.map((id, i) => ({ c: palette[i % palette.length], l: nameOf[id] || id }))));
    charts.appendChild(cc); attachLineTip(cc, series, cd);
  }
  if (tr.open_quests_by_tier) {
    const colors = { red: COL.red, orange: COL.orange, yellow: COL.yellow };
    const tierLbl = { red: 'critical', orange: 'important', yellow: 'housekeeping' };
    const cc = chartCard('Open tasks by priority', null, stackedBar(tr.open_quests_by_tier, ['red', 'orange', 'yellow'], colors, cd));
    cc.insertAdjacentHTML('beforeend', legend([{ c: COL.red, l: 'critical' }, { c: COL.orange, l: 'important' }, { c: COL.yellow, l: 'housekeeping' }]));
    charts.appendChild(cc); attachBarTip(cc, tr.open_quests_by_tier, ['red', 'orange', 'yellow'], colors, cd, tierLbl);
  }
  if (tr.git_risk) {
    const colors = { high: COL.red, medium: COL.orange, low: COL.green };
    const cc = chartCard('Git-safety risk', null, stackedBar(tr.git_risk, ['high', 'medium', 'low'], colors, cd));
    cc.insertAdjacentHTML('beforeend', legend([{ c: COL.red, l: 'high' }, { c: COL.orange, l: 'medium' }, { c: COL.green, l: 'low' }]));
    charts.appendChild(cc); attachBarTip(cc, tr.git_risk, ['high', 'medium', 'low'], colors, cd);
  }
  aosKids(charts, 'zoom-in', 70);
}

// --- Momentum forecast + Follow-through (folded from the retired ATLAS realm) --
// derive.momentum() fits a least-squares slope over S.trends.xp, then
// foresight.forecastLine() turns that into a display-ready trend word + ETA.
// `now` is threaded in from the caller (never computed here or in the pure
// intel modules) so this card time-travels correctly under the time-machine
// scrubber, same as its neighbours.
const TREND_LABEL = { rising: 'Rising', falling: 'Falling', flat: 'Flat' };

function forecastCard(S, now) {
  const m = momentum(S.trends, S.account, now);
  const f = forecastLine(m);
  const target = num(S.account?.level) + 1;
  const sign = f.slopePerScan > 0 ? '+' : '';
  const slopeTxt = `${sign}${f.slopePerScan} XP/scan`;
  const sampleN = (S.trends?.xp || []).length;
  const basisLine = `<div class="atl-fc-basis">based on ${esc(String(sampleN))} scan${sampleN === 1 ? '' : 's'}</div>`;
  let body;
  if (f.trend === 'falling') body = `<div class="atl-fc-note">XP is trending down — no level ETA.</div>`;
  else if (f.trend === 'flat' || f.etaLabel === '—') body = `<div class="atl-fc-note">Not enough forward motion to project a date.</div>`;
  else body = `<div class="atl-fc-eta">${esc(f.etaLabel)} to L${fmt(target)}</div>`;
  const inner = `
    <div class="atl-forecast">
      <div class="atl-fc-slope">${esc(slopeTxt)}</div>
      ${body}
      ${basisLine}
    </div>`;
  return chartCard('Momentum forecast', esc(TREND_LABEL[f.trend] || f.trend), inner);
}

// actedOn.entries clipped to curDate. resolved := resolved || marked_done (the
// ledger grew a marked_done field mid-life; older rows only carry resolved).
function followCard(bundle, cd) {
  const entries = bundle.actedOn?.entries || [];
  const seen = entries.filter((e) => day(e.at) <= cd);
  if (!seen.length) return emptyChartCard('Follow-through', 'No prompted actions taken yet.');
  const total = seen.length;
  const resolved = seen.filter((e) => e.resolved === true || e.marked_done === true).length;
  const rate = pct(resolved, total);
  const inner = `
    <div class="atl-ft">
      <div class="atl-bar"><i style="width:${rate}%"></i></div>
      <div class="atl-ft-row"><span>${fmt(resolved)} resolved</span><span>${fmt(total)} acted on</span></div>
    </div>`;
  return chartCard('Follow-through', rate + '%', inner);
}

function renderProgress(parent, S, ctx) {
  const cd = S.scan?.id || '';
  const bundle = ctx.data.bundle || {};
  const now = new Date().toISOString();   // injected here, never inside intel/*.mjs (they stay pure)
  const grid = el('div', 'charts');
  grid.appendChild(forecastCard(S, now));
  grid.appendChild(followCard(bundle, cd));
  aosKids(grid, 'zoom-in', 60);
  parent.appendChild(grid);
}

function renderConsistency(parent, ctx) {
  const LX = ctx.LX;
  const days = new Set();
  ctx.data.scans.forEach((s) => { if ((s.quests || []).some((q) => q.completed === s.scan.id)) days.add(s.scan.id); });
  const frags = days.size;
  const max = CONSISTENCY_THRESHOLDS.length;
  const level = CONSISTENCY_THRESHOLDS.filter((t) => frags >= t).length;
  const next = CONSISTENCY_THRESHOLDS.find((t) => t > frags);
  parent.appendChild(el('h2', 'sec', `${LX('blessing_head')} · level ${level}`));
  const card = el('div', 'blessing');
  const pct = next ? Math.round((frags / next) * 100) : 100;
  const left = next ? next - frags : 0;
  card.innerHTML = `
    <div class="bl-row">
      <span class="bl-frags">${'●'.repeat(Math.min(level, max))}${'○'.repeat(Math.max(0, max - level))}</span>
      <span class="bl-num">${frags} ${LX('fragment_word')}</span>
      <span class="bl-buff">Level ${level} / ${max}</span>
    </div>
    <div class="bl-bar"><i style="width:${pct}%"></i></div>
    <div class="bl-next">${next ? `${left} more active day${left > 1 ? 's' : ''} to reach level ${level + 1}` : 'Every level reached — great consistency.'}</div>`;
  parent.appendChild(card);
}

// A trophy's unfolded panel: unlock criteria, progress (or unlock date). Built
// on demand from the scan's achievement record + static ACH catalog copy.
function achDetail(x, meta) {
  const rows = [`<div class="nxd-row"><span class="nxd-k">Unlock</span><span class="nxd-v">${esc(meta.desc || '—')}</span></div>`];
  if (x.unlocked) {
    rows.push(`<div class="nxd-row"><span class="nxd-k">Status</span><span class="nxd-v ok">✓ unlocked${x.unlocked_on ? ' · ' + esc(x.unlocked_on) : ''}</span></div>`);
  } else if (x.progress) {
    const have = x.progress.have, need = x.progress.need;
    if (Number.isFinite(need) && need > 0) {
      const pct = Math.min(100, Math.round((have / need) * 100));
      rows.push(`<div class="nxd-row"><span class="nxd-k">Progress</span><span class="nxd-v">${esc(fmt(have))} / ${esc(fmt(need))} · ${pct}%</span></div>`);
      rows.push(`<div class="nxd-bar"><i style="width:${pct}%"></i></div>`);
    } else {
      // "drive to zero" goals (need = 0): show what's left to clear
      rows.push(`<div class="nxd-row"><span class="nxd-k">Remaining</span><span class="nxd-v">${esc(fmt(have))} to clear · target 0</span></div>`);
    }
  } else {
    rows.push(`<div class="nxd-row"><span class="nxd-k">Status</span><span class="nxd-v">locked · not started</span></div>`);
  }
  return `<div class="nx-detail ach-detail">${rows.join('')}</div>`;
}

function toggleAch(card, x, meta) {
  if (openAch.has(x.id)) { openAch.delete(x.id); card.classList.remove('open'); const d = card.querySelector('.ach-detail'); if (d) d.remove(); }
  else { openAch.add(x.id); card.classList.add('open'); card.insertAdjacentHTML('beforeend', achDetail(x, meta)); }
  sfx('blip');
}

// Trophies live inside HISTORY — one review tab, not two.
// Must run AFTER renderTrends (which clears the realm root).
function renderAchievements(ac, S, ctx) {
  renderConsistency(ac, ctx);
  ac.appendChild(el('h2', 'sec', `${ctx.LX('memorials')} · ${(S.achievements || []).filter((x) => x.unlocked).length} unlocked`));
  const grid = el('div', 'ach-grid'); ac.appendChild(grid);
  (S.achievements || []).forEach((x) => {
    const meta = ACH[x.id] || { name: x.id, icon: PX.trophy, desc: '' };
    const isOpen = openAch.has(x.id);
    const card = el('div', 'ach nx-ach' + (x.unlocked ? ' unlocked' : '') + (isOpen ? ' open' : ''));
    card.setAttribute('data-expand', '');
    let foot = '';
    if (x.unlocked) foot = `<div class="pnum">unlocked ${esc(x.unlocked_on || '')}</div>`;
    else if (x.progress) {
      const pct = x.progress.need ? Math.min(100, Math.round((x.progress.have / x.progress.need) * 100)) : 0;
      foot = `<div class="pbar"><i style="width:${pct}%"></i></div><div class="pnum">${x.progress.have} / ${x.progress.need}</div>`;
    } else foot = `<div class="pnum">locked</div>`;
    card.innerHTML = `<div class="icon">${meta.icon}</div><div class="name">${esc(meta.name)}</div><div class="desc">${esc(meta.desc)}</div>${foot}${isOpen ? achDetail(x, meta) : ''}`;
    card.onclick = () => toggleAch(card, x, meta);
    grid.appendChild(card);
  });
  aosKids(grid, 'zoom-in', 35);
}

let root = null;
let ctx = null;
let offSelect = null;

function render() {
  if (!root || !ctx) return;
  if (!ctx.data.selected) { root.innerHTML = ''; return; }
  const { S } = deriveScanContext(ctx.data);
  root.innerHTML = '';
  renderTrends(root, S);
  renderProgress(root, S, ctx);
  renderAchievements(root, S, ctx);
  aosRefresh();
}

export const view = {
  mount(stage, c) {
    ctx = c;
    root = el('div', 'realm-legacy');
    stage.appendChild(root);
    offSelect = c.bus.on('data:select', render);
    render();
  },
  unmount() {
    if (offSelect) { offSelect(); offSelect = null; }
    root = null; ctx = null;
  },
};
