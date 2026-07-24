// WATCHTOWER — the Screen Time realm. Every surface is pure derivation over the
// browsing time already captured per scan (S.browser, written by the Bridge
// extension) — no new data contract, no IPC. Rollups honour the time-machine
// scrubber: only scans at-or-before the selected snapshot are read, so viewing
// the past shows the past.
import { el, esc, fmt } from '../../ui/util.js';
import { fmtDur, aosKids, aosRefresh, sfx } from '../../ui/components.js';
import { categorize, CATEGORIES } from './categories.js';

const TOP_N = 8;
const isDistractingCat = (c) => c === 'social' || c === 'video';

// which platform cards are expanded. Module-scope so a data:select re-render
// (or a remount) repaints exactly the panels the user left open. Keyed by the
// stable domain string.
const openDoms = new Set();

// scans up to (and including) the selection that actually captured browsing —
// older scans predate the Bridge and carry no browser block at all.
function browserScans(data) {
  return data.scans
    .slice(0, data.selectedIndex + 1)
    .filter((s) => s.browser && s.browser.captured && Array.isArray(s.browser.by_domain) && s.browser.by_domain.length)
    // entries cross the Bridge-extension seam — normalize once so a null or
    // domain-less entry can't throw in domSum/rollup's sort tiebreak
    .map((s) => ({ ...s, browser: { ...s.browser, by_domain: s.browser.by_domain.filter((d) => d && typeof d.domain === 'string') } }))
    .filter((s) => s.browser.by_domain.length);
}

const domSum = (B, pick) => B.by_domain.reduce((t, d) => t + (pick && !pick(d) ? 0 : (d.focus_ms || 0)), 0);

// per-domain rollup across the captured scans; series (time) and visitsSeries
// are indexed per scan-with-browser (0 where the domain didn't surface that
// day). lastTs/title track the most recent visit so the detail can name it.
function rollup(scansB) {
  const byDom = new Map();
  scansB.forEach((s, i) => {
    for (const d of s.browser.by_domain) {
      const r = byDom.get(d.domain) || {
        domain: d.domain, total: 0, days: 0, visits: 0, lastTs: 0, title: '',
        series: new Array(scansB.length).fill(0),
        visitsSeries: new Array(scansB.length).fill(0),
      };
      r.total += d.focus_ms || 0;
      r.days += 1;
      r.series[i] = d.focus_ms || 0;
      r.visits += d.visits || 0;
      r.visitsSeries[i] = d.visits || 0;
      const lt = d.last_ts || 0;                       // >= so a later scan wins ties → newest title
      if (lt >= r.lastTs) { r.lastTs = lt; if (d.title) r.title = d.title; }
      byDom.set(d.domain, r);
    }
  });
  return [...byDom.values()].sort((a, b) => (b.total - a.total) || a.domain.localeCompare(b.domain));
}

// domain → owning project name, from the by_project attribution the Bridge
// already records. Chronological walk means the most recent capture's mapping
// wins (deterministic — scansB is ordered).
function projectMap(scansB) {
  const m = new Map();
  for (const s of scansB) {
    for (const p of (s.browser.by_project || [])) {
      for (const dom of (p.domains || [])) {
        if (dom && p.project_name) m.set(dom, p.project_name);
      }
    }
  }
  return m;
}

// social+video share of the reference scan's visible time, 0-100. Both the
// numerator and denominator read by_domain so the ratio compares like to like.
function distractPct(B) {
  const all = domSum(B);
  return all ? Math.round((domSum(B, (d) => isDistractingCat(categorize(d.domain))) / all) * 100) : 0;
}
const distractTier = (pct) => (pct < 35 ? 'low' : pct < 65 ? 'mid' : 'high');

// direction of a captured-scan-over-scan change; null when there's no prior
// capture to compare against (single-day history).
function trend(cur, prev) {
  if (prev == null) return null;
  const d = cur - prev;
  return { d, glyph: d > 0 ? '▲' : d < 0 ? '▼' : '●', dir: d > 0 ? 'up' : d < 0 ? 'down' : 'flat' };
}
// percent-change label for a time delta; 'new' when it climbed from nothing.
function trendPct(t, prev) {
  if (!t) return '';
  if (t.d === 0) return '±0';
  if (!prev) return t.d > 0 ? 'new' : '—';
  const p = Math.round((t.d / prev) * 100);
  return (p > 0 ? '+' : '') + p + '%';
}
const trendChip = (t, label) => (t ? `<span class="wt-trend ${t.dir}" title="vs previous captured scan">${esc(label)}</span>` : '');

// consecutive scan-over-scan INCREASES in social time ending at the selected
// snapshot (strict growth; video rides the meter, not the streak).
function socialStreak(scansB) {
  const per = scansB.map((s) => domSum(s.browser, (d) => categorize(d.domain) === 'social'));
  let streak = 0;
  for (let i = 1; i < per.length; i++) streak = per[i] > per[i - 1] ? streak + 1 : 0;
  return streak;
}

// day-of-week buckets, Monday-first; scans are daily so each captured scan
// contributes its whole visible time to its weekday.
function weekBuckets(scansB) {
  const b = new Array(7).fill(0);
  for (const s of scansB) {
    const t = Date.parse(s.scan.id + 'T00:00:00Z');   // UTC so the bucket never drifts with local tz
    if (!Number.isFinite(t)) continue;
    b[(new Date(t).getUTCDay() + 6) % 7] += domSum(s.browser);   // getUTCDay: 0=Sun
  }
  return b;
}

// ------------------------------------------------------------ svg fragments
function dialSvg(pct) {
  const r = 78, cx = 100, cy = 104;
  const len = Math.PI * r;
  const off = len - (len * pct) / 100;
  return `<svg class="wt-dial-svg" viewBox="0 0 200 118" role="img" aria-label="Distraction meter, ${pct} percent of browsing time">
    <path class="wt-arc bg" d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}"/>
    <path class="wt-arc val" d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}"
      style="stroke-dasharray:${len.toFixed(1)};stroke-dashoffset:${off.toFixed(1)}"/>
    <text class="wt-dial-num" x="${cx}" y="90" text-anchor="middle">${pct}%</text>
    <text class="wt-dial-sub" x="${cx}" y="108" text-anchor="middle">DISTRACTING</text>
  </svg>`;
}

function sparkSvg(series, color) {
  const W = 120, H = 26, n = series.length;
  const max = Math.max(1, ...series);
  const x = (i) => (n === 1 ? W - 4 : 4 + (i * (W - 8)) / (n - 1));
  const y = (v) => (H - 4) - ((v / max) * (H - 8));
  if (n === 1) return `<svg class="wt-spark" viewBox="0 0 ${W} ${H}"><circle cx="${x(0)}" cy="${y(series[0]).toFixed(1)}" r="2.5" fill="${color}"/></svg>`;
  const pts = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return `<svg class="wt-spark" viewBox="0 0 ${W} ${H}">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="${x(n - 1).toFixed(1)}" cy="${y(series[n - 1]).toFixed(1)}" r="2.2" fill="${color}"/>
  </svg>`;
}

// ------------------------------------------------------------------ sections
function renderTrendBanner(parent, scansB) {
  const streak = socialStreak(scansB);
  if (streak < 3) return;
  parent.appendChild(el('div', 'wt-doom',
    `<span class="wt-doom-k">↑ Trend</span>
     <span class="wt-doom-t">Social time has risen ${streak} scans in a row.</span>`));
}

function renderOverview(parent, scansB, roll) {
  parent.appendChild(el('h2', 'sec', 'Overview'));
  const grid = el('div', 'wt-top');
  parent.appendChild(grid);

  const ref = scansB[scansB.length - 1].browser;   // nearest captured window at-or-before the selection
  const pct = distractPct(ref);
  const tier = distractTier(pct);
  // trend vs the previous captured scan (points of distraction share, not %-of-%).
  const at = scansB.length > 1 ? trend(pct, distractPct(scansB[scansB.length - 2].browser)) : null;
  const atLabel = at ? `${at.glyph} ${at.d > 0 ? '+' : ''}${at.d} pts` : '';
  const dial = el('div', `wt-panel wt-dial ${tier}`,
    `<div class="wt-k">Distraction meter · social &amp; video share</div>
     ${dialSvg(pct)}
     <div class="wt-scale">
       <span class="${tier === 'low' ? 'on' : ''}">Low</span>
       <span class="${tier === 'mid' ? 'on' : ''}">Moderate</span>
       <span class="${tier === 'high' ? 'on' : ''}">High</span>
     </div>
     ${at ? `<div class="wt-dial-trend">${trendChip(at, atLabel)}<span class="wt-trend-cap">vs last capture</span></div>` : ''}`);
  grid.appendChild(dial);

  const buckets = weekBuckets(scansB);
  const max = Math.max(1, ...buckets);
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const cells = buckets.map((v, i) =>
    `<div class="wt-wc" title="${days[i]} · ${fmtDur(v)}">
       <span class="box"><i style="opacity:${v ? (0.15 + 0.85 * (v / max)).toFixed(2) : 0.05}"></i></span>
       <b>${days[i][0]}</b>
     </div>`).join('');
  grid.appendChild(el('div', 'wt-panel',
    `<div class="wt-k">Weekly rhythm · time by weekday</div><div class="wt-week">${cells}</div>`));

  const grand = roll.reduce((t, r) => t + r.total, 0);
  const busiest = roll[0];
  grid.appendChild(el('div', 'wt-panel',
    `<div class="wt-k">Summary</div>
     <div class="wt-cen-row"><span>Total time</span><b>${fmtDur(grand)}</b></div>
     <div class="wt-cen-row"><span>Sites tracked</span><b>${roll.length}</b></div>
     <div class="wt-cen-row"><span>Days captured</span><b>${scansB.length}</b></div>
     ${busiest ? `<div class="wt-cen-row"><span>Busiest site</span><b>${esc(busiest.domain.replace(/^www\./, ''))}</b></div>` : ''}`));
  aosKids(grid, 'fade-up', 60);
}

// inline detail for one platform — the per-day time history, category, peak,
// first-seen, and any project attribution. Built lazily on expand, rebuilt on a
// data:select repaint for domains still in openDoms.
function detailNode(r, scansB, projMap) {
  const cat = CATEGORIES[categorize(r.domain)] || CATEGORIES.other;
  const maxS = Math.max(1, ...r.series);
  let peak = 0, peakIdx = 0;
  r.series.forEach((v, i) => { if (v > peak) { peak = v; peakIdx = i; } });
  const firstIdx = r.series.findIndex((v) => v > 0);
  const proj = projMap.get(r.domain);
  const dLabel = (i) => esc(scansB[i].scan.id.slice(5));   // "07-24"
  const rows = r.series.map((v, i) => {
    const w = ((v / maxS) * 100).toFixed(1);
    const vis = r.visitsSeries[i];
    return `<div class="wt-hrow${v ? '' : ' zero'}">
      <span class="wt-hd">${dLabel(i)}</span>
      <span class="wt-hbar"><i style="width:${v ? w : 0}%"></i></span>
      <span class="wt-hv">${v ? esc(fmtDur(v)) : '—'}${v && vis ? ` · ${esc(fmt(vis))}v` : ''}</span>
    </div>`;
  }).join('');
  const det = el('div', 'nx-detail',
    `<div class="wt-dt-grid">
       <div class="wt-dt-c"><span>Category</span><b style="color:${cat.color}">${cat.label}</b></div>
       <div class="wt-dt-c"><span>Peak day</span><b>${esc(fmtDur(peak))} · ${dLabel(peakIdx)}</b></div>
       <div class="wt-dt-c"><span>First seen</span><b>${firstIdx >= 0 ? dLabel(firstIdx) : '—'}</b></div>
       <div class="wt-dt-c"><span>Total visits</span><b>${esc(fmt(r.visits))}</b></div>
       ${proj ? `<div class="wt-dt-c wide"><span>Project</span><b>↳ ${esc(proj)}</b></div>` : ''}
     </div>
     ${r.title ? `<div class="wt-dt-title" title="${esc(r.title)}">“${esc(r.title)}”</div>` : ''}
     <div class="wt-dt-k">Time by day</div>
     <div class="wt-hist">${rows}</div>`);
  det.addEventListener('click', (e) => e.stopPropagation());   // clicks inside don't collapse the card
  return det;
}

function toggleCard(card, r, scansB, projMap) {
  const willOpen = !openDoms.has(r.domain);
  if (willOpen) {
    openDoms.add(r.domain);
    card.classList.add('open');
    if (!card.querySelector('.nx-detail')) card.appendChild(detailNode(r, scansB, projMap));
    sfx('open');
  } else {
    openDoms.delete(r.domain);
    card.classList.remove('open');
    const d = card.querySelector('.nx-detail');
    if (d) d.remove();
    sfx('blip');
  }
}

function renderPlatforms(parent, scansB, roll) {
  const top = roll.slice(0, TOP_N);
  const projMap = projectMap(scansB);
  parent.appendChild(el('h2', 'sec', `Platforms · top ${top.length}`));
  const grid = el('div', 'wt-grid');
  parent.appendChild(grid);
  for (const r of top) {
    const cat = CATEGORIES[categorize(r.domain)] || CATEGORIES.other;
    const n = r.series.length;
    const prevV = n > 1 ? r.series[n - 2] : null;
    const t = trend(r.series[n - 1], prevV);
    const tlabel = t ? `${t.glyph} ${trendPct(t, prevV)}` : '';
    const open = openDoms.has(r.domain);
    const card = el('div', 'wt-card' + (open ? ' open' : ''),
      `<div class="wt-dom-row">
         <span class="wt-dom" title="${esc(r.domain)}">${esc(r.domain.replace(/^www\./, ''))}</span>
         <span class="wt-chip">${cat.label}</span>
         <span class="wt-exp" aria-hidden="true">▸</span>
       </div>
       <div class="wt-total-row">
         <span class="wt-total">${esc(fmtDur(r.total))}</span>
         ${trendChip(t, tlabel)}
       </div>
       ${sparkSvg(r.series, cat.color)}
       <div class="wt-cadence">Seen ${r.days}/${scansB.length} days · ${esc(fmt(r.visits))} visits</div>`);
    card.setAttribute('data-expand', '');   // cinematic theme styles hover + .open off this
    card.style.setProperty('--cc', cat.color);
    if (open) card.appendChild(detailNode(r, scansB, projMap));
    card.addEventListener('click', () => toggleCard(card, r, scansB, projMap));   // in-root node → dies with the rebuild
    grid.appendChild(card);
  }
  aosKids(grid, 'zoom-in', 45);
}

function renderEmpty(parent) {
  parent.appendChild(el('div', 'wt-empty',
    `<div class="wt-empty-head">No browsing captured yet</div>
     <div class="wt-empty-sub">There's no browsing time in any snapshot. Load the <b>WorkspaceHQ Bridge</b>
       extension (<code>browser-bridge/</code> → chrome://extensions → Load unpacked)
       and tracking begins on the next scan.</div>`));
}

// ------------------------------------------------------------------- realm
let root = null;
let ctx = null;
let offSelect = null;

function render() {
  if (!root || !ctx) return;
  root.innerHTML = '';
  const S = ctx.data.selected;
  if (!S) return;
  const scansB = browserScans(ctx.data);
  if (!scansB.length) { renderEmpty(root); return; }
  const roll = rollup(scansB);
  renderTrendBanner(root, scansB);
  renderOverview(root, scansB, roll);
  renderPlatforms(root, scansB, roll);
  aosRefresh();
}

export const view = {
  mount(stage, c) {
    ctx = c;
    root = el('div', 'realm-watchtower');
    stage.appendChild(root);
    offSelect = c.bus.on('data:select', render);
    render();
  },
  unmount() {
    if (offSelect) { offSelect(); offSelect = null; }
    root = null; ctx = null;
  },
};
