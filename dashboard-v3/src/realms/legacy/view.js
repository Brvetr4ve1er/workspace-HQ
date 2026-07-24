// LEGACY — v2's STATS tab, enriched: PERSONAL RECORDS callout, trend charts with
// hover tooltips (value + date at the snapped point), Completion grove blessing,
// and clickable trophy cards that unfold their unlock criteria / progress.
// Render order: records → charts → blessing → memorials grid.
import { el, esc, COL, fmt } from '../../ui/util.js';
import { lineChart, stackedBar, legend, chartCard, aosKids, aosRefresh, deriveScanContext, sfx, ACH, PX } from '../../ui/components.js';

// Scadutree Fragments (CANON P4): parallel COSMETIC progression, off the XP
// ledger. Derived at render — one fragment per calendar day with ≥1 completed
// hunt across all recorded scans. Thresholds grant Blessing levels (flavor).
const BLESSING_THRESHOLDS = [1, 3, 5, 8, 12, 17, 23, 30];

// Chart geometry — MUST mirror ui/components.js lineChart/stackedBar so the
// tooltip snaps to the same pixels the SVG was drawn with.
const CW = 320, CH = 130, CPAD = 26;

// Trophy expand state: survives data:select re-renders (module scope), keyed by
// achievement id — same pattern as grimoire's openTails.
const openAch = new Set();

// ---------------------------------------------------------- personal records
// All derived from the SELECTED scan's trend arrays (filtered p.d <= cd) so the
// Memory-of-Grace scrubber time-travels the records too. Deterministic.
const peak = (pts) => { let b = null; for (const p of pts) if (b === null || p.v > b.v) b = p; return b; };
const longestDailyRun = (pts) => {
  if (!pts.length) return null;
  const day = (d) => Math.floor(Date.parse(d + 'T00:00:00Z') / 86400000);
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
  if (cpk && cpk.v > 0) recs.push({ c: COL.orange, ic: '⚡', k: 'Most spells / day', v: fmt(cpk.v), sub: cpk.d });

  let bc = null; const cbp = tr.completion_by_project || {};
  for (const id of Object.keys(cbp)) for (const p of f(cbp[id])) if (bc === null || p.v > bc.v) bc = { v: p.v, id, d: p.d };
  if (bc) recs.push({ c: COL.blue, ic: '◆', k: 'Best completion', v: bc.v + '%', sub: `${nameOf[bc.id] || bc.id} · ${bc.d}` });

  if (!recs.length) return;
  parent.appendChild(el('h2', 'sec', 'PERSONAL RECORDS'));
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

function attachBarTip(chartEl, rows0, keys, colors, cd) {
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
      const body = keys.map((k) => `<span class="tp-row"><i style="background:${colors[k]}"></i>${esc(k)} <b>${esc(fmt(row[k] || 0))}</b></span>`).join('');
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
    const cc = chartCard('Spells cast / day', last(tr.casts_per_day), lineChart(s, cd));
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
    const cc = chartCard('Open quests by tier', null, stackedBar(tr.open_quests_by_tier, ['red', 'orange', 'yellow'], colors, cd));
    cc.insertAdjacentHTML('beforeend', legend([{ c: COL.red, l: 'red' }, { c: COL.orange, l: 'orange' }, { c: COL.yellow, l: 'yellow' }]));
    charts.appendChild(cc); attachBarTip(cc, tr.open_quests_by_tier, ['red', 'orange', 'yellow'], colors, cd);
  }
  if (tr.git_risk) {
    const colors = { high: COL.red, medium: COL.orange, low: COL.green };
    const cc = chartCard('Git-safety risk', null, stackedBar(tr.git_risk, ['high', 'medium', 'low'], colors, cd));
    cc.insertAdjacentHTML('beforeend', legend([{ c: COL.red, l: 'high' }, { c: COL.orange, l: 'medium' }, { c: COL.green, l: 'low' }]));
    charts.appendChild(cc); attachBarTip(cc, tr.git_risk, ['high', 'medium', 'low'], colors, cd);
  }
  aosKids(charts, 'zoom-in', 70);
}

function renderBlessing(parent, ctx) {
  const LX = ctx.LX;
  const days = new Set();
  ctx.data.scans.forEach((s) => { if ((s.quests || []).some((q) => q.completed === s.scan.id)) days.add(s.scan.id); });
  const frags = days.size;
  const level = BLESSING_THRESHOLDS.filter((t) => frags >= t).length;
  const next = BLESSING_THRESHOLDS.find((t) => t > frags);
  parent.appendChild(el('h2', 'sec', `${LX('blessing_head')} · level ${level}`));
  const card = el('div', 'blessing');
  const pct = next ? Math.round((frags / next) * 100) : 100;
  card.innerHTML = `
    <div class="bl-row">
      <span class="bl-frags">${'✦'.repeat(Math.min(level, 8))}${'✧'.repeat(Math.max(0, 8 - level))}</span>
      <span class="bl-num">${frags} ${LX('fragment_word')}</span>
      <span class="bl-buff">+${level * 5}% vigor</span>
    </div>
    <div class="bl-bar"><i style="width:${pct}%"></i></div>
    <div class="bl-next">${next ? `${next - frags} more day${next - frags > 1 ? 's' : ''} with a completed hunt until the next blessing` : 'the grove is full — every blessing earned'}</div>`;
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

// Trophies live inside STATS ("HIGH SCORES") — one review tab, not two.
// Must run AFTER renderTrends (which clears the realm root).
function renderAchievements(ac, S, ctx) {
  renderBlessing(ac, ctx);
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
