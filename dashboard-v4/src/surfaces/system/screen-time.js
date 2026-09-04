// SYSTEM · SCREEN TIME — the browsing rollup. Content ported from v3
// realms/watchtower/view.js; every derivation now lives in the pure
// screen-core.mjs beside this file (node --test'd), so this module is DOM only.
//
// The whole section is derivation over browsing time the Bridge extension
// already captured per scan (scan.browser) — no new data contract, no IPC.
// Rollups honour the time machine: only scans at-or-before the selected
// snapshot are read, so viewing the past shows the past.
import { el, esc, fmt, dur } from '../../ui/util.js';
import { CATEGORIES, categorize } from './categories.mjs';
import {
  browserScans, rollup, projectMap, distractPct, distractTier,
  trend, trendPct, socialStreak, weekBuckets, summarize, platformDetail,
} from './screen-core.mjs';

const TOP_N = 8;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Which platform cards are expanded. Module scope so a data:select repaint (or
// a surface re-mount) restores exactly the panels the user left open. Keyed by
// the stable domain string.
const openDoms = new Set();

const catOf = (domain) => CATEGORIES[categorize(domain)] || CATEGORIES.other;

// The DOM layer resolves categories.mjs's colour KEY. v4.2 resolved it through
// ui/util.js's COL table, which is a neon signal palette: COL.red on the VIDEO
// category put an emergency colour on a card where nothing is wrong, and eight
// neon seams in one grid is the "messy" the v4.3 review named. These are the
// same eight hues pulled back to the muted register the exemplar uses for its
// status seams — still eight distinguishable categories, none of them shouting,
// and red/amber stay reserved for actual severity. `grey` has no COL entry by
// design (see categories.mjs); the fallback covers it and any future key.
const CAT_COLOR = {
  pink:   '#c58bb0',   // social
  red:    '#c98a8a',   // video
  green:  '#86b986',   // dev
  blue:   '#74a8dc',   // docs
  cyan:   '#6fb1c4',   // ai
  orange: '#c99a6b',   // news
  gold:   '#c2b273',   // shopping
};
const catColor = (cat) => CAT_COLOR[cat.col] || '#8d86b3';
const shortDom = (d) => String(d).replace(/^www\./, '');

// ------------------------------------------------------------ svg fragments
// The v4.2 dial carried a second SVG label at font-size 9 — roughly 10.8px once
// the 200-unit viewBox was scaled to its rendered width, under the
// constitution's 12px floor. It said "DISTRACTING", which the caption above the
// dial and the headline beside it both already say, so it is gone rather than
// resized: the fix for a caption nobody needed is not a bigger caption.
function dialSvg(pct) {
  const r = 78, cx = 100, cy = 104;
  const len = Math.PI * r;
  const off = len - (len * pct) / 100;
  return `<svg class="wt-dial-svg" viewBox="0 0 200 118" role="img" aria-label="Distraction meter, ${pct} percent of browsing time">
    <path class="wt-arc bg" d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}"/>
    <path class="wt-arc val" d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}"
      style="stroke-dasharray:${len.toFixed(1)};stroke-dashoffset:${off.toFixed(1)}"/>
    <text class="wt-dial-num" x="${cx}" y="96" text-anchor="middle">${pct}%</text>
  </svg>`;
}

function sparkSvg(series, color) {
  const W = 120, H = 26, n = series.length;
  const max = Math.max(1, ...series);
  const x = (i) => (n === 1 ? W - 4 : 4 + (i * (W - 8)) / (n - 1));
  const y = (v) => (H - 4) - ((v / max) * (H - 8));
  if (n === 1) return `<svg class="wt-spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><circle cx="${x(0)}" cy="${y(series[0]).toFixed(1)}" r="2.5" fill="${color}"/></svg>`;
  const pts = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return `<svg class="wt-spark" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/>
    <circle cx="${x(n - 1).toFixed(1)}" cy="${y(series[n - 1]).toFixed(1)}" r="2.2" fill="${color}"/>
  </svg>`;
}

const trendChip = (t, label) =>
  (t ? `<span class="chip wt-trend" data-dir="${t.dir}" title="vs previous captured scan">${esc(label)}</span>` : '');

// ------------------------------------------------------------------ section
export function createScreenSection(api) {
  // api: { hq, data, alive() }
  const root = el('div', 'sys-sec');

  function renderEmpty() {
    root.appendChild(el('section', 'panel', `
      <div class="panel-head"><span class="panel-title">Screen time</span><span class="panel-sub">no captures</span></div>
      <div class="panel-body">
        <div class="empty">
          <div class="wt-empty-head">No browsing captured yet</div>
          <div class="wt-empty-sub">There is no browsing time in any snapshot at or before this one. Load the
            <b>WorkspaceHQ Bridge</b> extension (<code>browser-bridge/</code> → chrome://extensions → Load unpacked)
            and tracking begins on the next scan.</div>
        </div>
      </div>`));
  }

  function renderOverview(scansB, roll) {
    const ref = scansB[scansB.length - 1].browser;   // nearest captured window at-or-before the selection
    const pct = distractPct(ref);
    const tier = distractTier(pct);
    // trend vs the previous captured scan, in POINTS of distraction share
    // (not a percentage of a percentage — that would be a different claim).
    const at = scansB.length > 1 ? trend(pct, distractPct(scansB[scansB.length - 2].browser)) : null;
    const atLabel = at ? `${at.glyph} ${at.d > 0 ? '+' : ''}${at.d} pts` : '';

    const buckets = weekBuckets(scansB);
    const max = Math.max(1, ...buckets);
    const cells = buckets.map((v, i) =>
      `<div class="wt-wc" title="${DAYS[i]} · ${esc(dur(v))}">
         <span class="box"><i style="opacity:${v ? (0.15 + 0.85 * (v / max)).toFixed(2) : 0.05}"></i></span>
         <b>${DAYS[i][0]}</b>
       </div>`).join('');

    const sum = summarize(scansB, roll);
    const streak = socialStreak(scansB);

    // ONE focal element on this tab, built the same way MACHINE's is: the
    // verdict as a display-weight sentence, the dial beside it as the picture
    // of that sentence, and everything else demoted into quiet cards below.
    // v4.2 put the dial, the weekday grid and the summary in three equal
    // outlined boxes, so the tab had three co-equal focals, which is none.
    const dirWord = at ? (at.dir === 'up' ? 'up' : at.dir === 'down' ? 'down' : 'flat') : '';
    const sub = `Across ${fmt(sum.days)} captured scan${sum.days === 1 ? '' : 's'}.`
      + (at && dirWord !== 'flat' ? ` That share is ${dirWord} ${Math.abs(at.d)} point${Math.abs(at.d) === 1 ? '' : 's'} on the previous capture.` : '');

    const hero = el('section', 'sys-hero', `
      <div class="sys-hero-main">
        <div class="sys-eyebrow">Screen time</div>
        <h1 class="sys-health">${pct}% of your browsing is social or video</h1>
        <p class="sys-hero-sub">${esc(sub)}</p>
        <p class="sys-hero-host">${esc(dur(sum.grandMs))} tracked across ${fmt(sum.sites)} site${sum.sites === 1 ? '' : 's'}${sum.busiest ? ` · busiest ${esc(shortDom(sum.busiest))}` : ''}</p>
      </div>
      <div class="wt-dial" data-tier="${tier}">
        ${dialSvg(pct)}
        <div class="wt-scale">
          <span class="${tier === 'low' ? 'on' : ''}">Low</span>
          <span class="${tier === 'mid' ? 'on' : ''}">Moderate</span>
          <span class="${tier === 'high' ? 'on' : ''}">High</span>
        </div>
        ${at ? `<div class="wt-dial-trend">${trendChip(at, atLabel)}<span class="sys-cap">vs last capture</span></div>` : ''}
      </div>`);
    root.appendChild(hero);

    const panel = el('section', 'panel', `
      <div class="panel-head">
        <span class="panel-title">Rhythm</span>
        <span class="panel-sub">${fmt(sum.days)} captured scan${sum.days === 1 ? '' : 's'}</span>
      </div>
      <div class="panel-body">
        ${streak >= 3 ? `<div class="wt-doom"><span class="wt-doom-k">Rising</span><span class="wt-doom-t">Social time has risen ${streak} scans in a row.</span></div>` : ''}
        <div class="wt-top">
          <div class="wt-panel">
            <div class="sys-cap wt-k">Time by weekday</div>
            <div class="wt-week">${cells}</div>
          </div>
          <div class="wt-panel">
            <div class="sys-cap wt-k">Totals across every captured scan</div>
            <div class="wt-cen-row"><span>Total time</span><b>${esc(dur(sum.grandMs))}</b></div>
            <div class="wt-cen-row"><span>Sites tracked</span><b>${fmt(sum.sites)}</b></div>
            <div class="wt-cen-row"><span>Days captured</span><b>${fmt(sum.days)}</b></div>
            ${sum.busiest ? `<div class="wt-cen-row"><span>Busiest site</span><b>${esc(shortDom(sum.busiest))}</b></div>` : ''}
          </div>
        </div>
      </div>`);
    root.appendChild(panel);
  }

  // Inline detail for one platform — per-day history, category, peak, first
  // seen, visits and any project attribution. Built lazily on expand, rebuilt
  // on repaint for domains still in openDoms.
  function detailNode(r, scansB, projMap) {
    const cat = catOf(r.domain);
    const maxS = Math.max(1, ...r.series);
    const { peak, peakIdx, firstIdx } = platformDetail(r);
    const proj = projMap.get(r.domain);
    const dLabel = (i) => esc(String(scansB[i]?.scan?.id || '').slice(5));   // "07-24"
    const rows = r.series.map((v, i) => {
      const w = ((v / maxS) * 100).toFixed(1);
      const vis = r.visitsSeries[i];
      return `<div class="wt-hrow${v ? '' : ' is-zero'}">
        <span class="wt-hd">${dLabel(i)}</span>
        <span class="wt-hbar"><i style="width:${v ? w : 0}%"></i></span>
        <span class="wt-hv">${v ? esc(dur(v)) : '—'}${v && vis ? ` · ${esc(fmt(vis))}v` : ''}</span>
      </div>`;
    }).join('');
    return el('div', 'wt-detail', `
      <div class="wt-dt-grid">
        <div class="wt-dt-c"><span>Category</span><b style="color:${catColor(cat)}">${cat.label}</b></div>
        <div class="wt-dt-c"><span>Peak day</span><b>${esc(dur(peak))} · ${dLabel(peakIdx)}</b></div>
        <div class="wt-dt-c"><span>First seen</span><b>${firstIdx >= 0 ? dLabel(firstIdx) : '—'}</b></div>
        <div class="wt-dt-c"><span>Total visits</span><b>${esc(fmt(r.visits))}</b></div>
        ${proj ? `<div class="wt-dt-c is-wide"><span>Project</span><b>↳ ${esc(proj)}</b></div>` : ''}
      </div>
      ${r.title ? `<div class="meta wt-dt-title" title="${esc(r.title)}">“${esc(r.title)}”</div>` : ''}
      <div class="eyebrow wt-dt-k">Time by day</div>
      <div class="wt-hist">${rows}</div>`);
  }

  function renderPlatforms(scansB, roll) {
    const top = roll.slice(0, TOP_N);
    const projMap = projectMap(scansB);
    const panel = el('section', 'panel', `
      <div class="panel-head">
        <span class="panel-title">Platforms</span>
        <span class="panel-sub">top ${top.length} of ${fmt(roll.length)}</span>
      </div>
      <div class="panel-body"><div class="wt-grid"></div></div>`);
    const grid = panel.querySelector('.wt-grid');

    for (const r of top) {
      const cat = catOf(r.domain);
      const n = r.series.length;
      const prevV = n > 1 ? r.series[n - 2] : null;
      const t = trend(r.series[n - 1], prevV);
      const tlabel = t ? `${t.glyph} ${trendPct(t, prevV)}` : '';
      const open = openDoms.has(r.domain);

      // Disclosure pattern: the summary IS the toggle (a real <button>, so
      // keyboard and AT get it for free) and the detail is its sibling — the
      // detail carries block content, which may not live inside a button.
      const card = el('div', 'wt-card');
      // The category was a bordered `.chip` on every card. It is now a coloured
      // word in the label register, lit from the same --cc the card's 2px seam
      // and the history bars use — one variable, one accent, no box.
      const head = el('button', 'wt-card-head', `
        <span class="wt-dom-row">
          <span class="wt-dom" title="${esc(r.domain)}">${esc(shortDom(r.domain))}</span>
          <span class="chip wt-cat">${cat.label}</span>
          <span class="wt-exp" aria-hidden="true">▸</span>
        </span>
        <span class="wt-total-row">
          <span class="figure wt-total">${esc(dur(r.total))}</span>
          ${trendChip(t, tlabel)}
        </span>
        ${sparkSvg(r.series, catColor(cat))}
        <span class="sys-cap wt-cadence">Seen ${r.days}/${scansB.length} days · ${esc(fmt(r.visits))} visits</span>`);
      head.type = 'button';
      head.title = 'Show this platform’s day-by-day history';
      card.style.setProperty('--cc', catColor(cat));
      card.classList.toggle('is-open', open);
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
      card.appendChild(head);
      if (open) card.appendChild(detailNode(r, scansB, projMap));
      head.onclick = () => {
        const willOpen = !openDoms.has(r.domain);
        if (willOpen) {
          openDoms.add(r.domain);
          card.classList.add('is-open');
          if (!card.querySelector('.wt-detail')) card.appendChild(detailNode(r, scansB, projMap));
        } else {
          openDoms.delete(r.domain);
          card.classList.remove('is-open');
          card.querySelector('.wt-detail')?.remove();
        }
        head.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      };
      grid.appendChild(card);
    }
    root.appendChild(panel);
  }

  const scansB = browserScans(api.data?.scans, api.data?.selectedIndex);
  if (!scansB.length) renderEmpty();
  else {
    const roll = rollup(scansB);
    renderOverview(scansB, roll);
    renderPlatforms(scansB, roll);
  }

  // No timers, no global listeners, no async: every handler is a property on a
  // node inside root, so detaching root releases them.
  return { el: root, dispose() {} };
}
