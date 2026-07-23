// WATCHTOWER — the social overseer (charter realm 9, passive tier). Every
// surface is pure derivation over the browser dwell already captured per scan
// (S.browser, written by the Bridge extension) — no new data contract, no IPC.
// Rollups honour the Memory of Grace scrubber: only scans at-or-before the
// selected snapshot are read, so viewing the past shows the past.
import { el, esc } from '../../ui/util.js';
import { fmtDur, aosKids, aosRefresh } from '../../ui/components.js';
import { voiceLine } from '../../lexicon/voice.js';
import { categorize, CATEGORIES } from './categories.js';

const TOP_N = 8;
const isAggroCat = (c) => c === 'social' || c === 'video';

// scans up to (and including) the selection that actually captured dwell —
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

// per-domain rollup across the captured scans; series is indexed per
// scan-with-browser (0 where the domain didn't surface that day).
function rollup(scansB) {
  const byDom = new Map();
  scansB.forEach((s, i) => {
    for (const d of s.browser.by_domain) {
      const r = byDom.get(d.domain) || { domain: d.domain, total: 0, days: 0, series: new Array(scansB.length).fill(0) };
      r.total += d.focus_ms || 0;
      r.days += 1;
      r.series[i] = d.focus_ms || 0;
      byDom.set(d.domain, r);
    }
  });
  return [...byDom.values()].sort((a, b) => (b.total - a.total) || a.domain.localeCompare(b.domain));
}

// social+video share of the reference scan's visible dwell, 0-100. Both the
// numerator and denominator read by_domain so the ratio compares like to like.
function aggroPct(B) {
  const all = domSum(B);
  return all ? Math.round((domSum(B, (d) => isAggroCat(categorize(d.domain))) / all) * 100) : 0;
}
const aggroTier = (pct) => (pct < 35 ? 'calm' : pct < 65 ? 'watchful' : 'aggro');

// consecutive scan-over-scan INCREASES in social dwell ending at the selected
// snapshot (strict growth; video rides the meter, not the streak).
function socialStreak(scansB) {
  const per = scansB.map((s) => domSum(s.browser, (d) => categorize(d.domain) === 'social'));
  let streak = 0;
  for (let i = 1; i < per.length; i++) streak = per[i] > per[i - 1] ? streak + 1 : 0;
  return streak;
}

// day-of-week buckets, Monday-first; scans are daily so each captured scan
// contributes its whole visible dwell to its weekday.
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
  return `<svg class="wt-dial-svg" viewBox="0 0 200 118" aria-label="aggro ${pct} of 100">
    <path class="wt-arc bg" d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}"/>
    <path class="wt-arc val" d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}"
      style="stroke-dasharray:${len.toFixed(1)};stroke-dashoffset:${off.toFixed(1)}"/>
    <text class="wt-dial-num" x="${cx}" y="88" text-anchor="middle">${pct}</text>
    <text class="wt-dial-sub" x="${cx}" y="106" text-anchor="middle">AGGRO</text>
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
function renderDoom(parent, scansB, S) {
  const streak = socialStreak(scansB);
  if (streak < 3) return;
  const line = voiceLine('break_nudge', S.scan.id) || 'touch grass, Warden';
  parent.appendChild(el('div', 'wt-doom',
    `<span class="wt-doom-k">⚠ DOOMSCROLL</span>
     <span class="wt-doom-t">social dwell up ${streak} scans straight — ${esc(line)}</span>`));
}

function renderOverwatch(parent, scansB, roll) {
  parent.appendChild(el('h2', 'sec', 'THE OVERWATCH'));
  const grid = el('div', 'wt-top');
  parent.appendChild(grid);

  const ref = scansB[scansB.length - 1].browser;   // nearest captured window at-or-before the selection
  const pct = aggroPct(ref);
  const tier = aggroTier(pct);
  const dial = el('div', `wt-panel wt-dial ${tier}`,
    `<div class="wt-k">aggro meter · social+video share</div>
     ${dialSvg(pct)}
     <div class="wt-scale">
       <span class="${tier === 'calm' ? 'on' : ''}">calm</span>
       <span class="${tier === 'watchful' ? 'on' : ''}">watchful</span>
       <span class="${tier === 'aggro' ? 'on' : ''}">AGGRO'D</span>
     </div>`);
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
    `<div class="wt-k">weekly rhythm · dwell by weekday</div><div class="wt-week">${cells}</div>`));

  const grand = roll.reduce((t, r) => t + r.total, 0);
  const den = roll[0];
  grid.appendChild(el('div', 'wt-panel',
    `<div class="wt-k">watch log</div>
     <div class="wt-cen-row"><span>total dwell</span><b>${fmtDur(grand)}</b></div>
     <div class="wt-cen-row"><span>domains watched</span><b>${roll.length}</b></div>
     <div class="wt-cen-row"><span>days captured</span><b>${scansB.length}</b></div>
     ${den ? `<div class="wt-cen-row"><span>busiest den</span><b>${esc(den.domain.replace(/^www\./, ''))}</b></div>` : ''}`));
  aosKids(grid, 'fade-up', 60);
}

function renderPlatforms(parent, scansB, roll) {
  const top = roll.slice(0, TOP_N);
  parent.appendChild(el('h2', 'sec', `PLATFORM WATCH · top ${top.length}`));
  const grid = el('div', 'wt-grid');
  parent.appendChild(grid);
  for (const r of top) {
    const cat = CATEGORIES[categorize(r.domain)] || CATEGORIES.other;
    const card = el('div', 'wt-card',
      `<div class="wt-dom-row">
         <span class="wt-dom" title="${esc(r.domain)}">${esc(r.domain.replace(/^www\./, ''))}</span>
         <span class="wt-chip">${cat.label}</span>
       </div>
       <div class="wt-total">${fmtDur(r.total)}</div>
       ${sparkSvg(r.series, cat.color)}
       <div class="wt-cadence">cadence ${r.days}/${scansB.length} days</div>`);
    card.style.setProperty('--cc', cat.color);
    grid.appendChild(card);
  }
  aosKids(grid, 'zoom-in', 45);
}

function renderEmpty(parent) {
  parent.appendChild(el('div', 'wt-empty',
    `<div class="wt-empty-glyph">🗼</div>
     <div class="wt-empty-head">the spire sees nothing yet</div>
     <div class="wt-empty-sub">no browser dwell in any snapshot. Load the <b>WorkspaceHQ Bridge</b>
       extension (<code>browser-bridge/</code> → chrome://extensions → Load unpacked)
       and the watch begins next scan.</div>`));
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
  renderDoom(root, scansB, S);
  renderOverwatch(root, scansB, roll);
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
